import { classifyUpstream, isRetryable, openAiErrorBody, redactSecrets, sseErrorFrames } from "~/server/gateway/errors";
import { clientHeaders, upstreamHeaders } from "~/server/gateway/headers";
import { catalog, resolveAlias, resolveChain } from "~/server/gateway/resolve";
import type { Upstream } from "~/server/gateway/upstreams";
import { costMicros, makeUsageSniffer, usageFromSseEvent } from "~/server/gateway/usage";

const upstream = (over: Partial<Upstream> & { name: string }): Upstream => ({
  baseUrl: `https://${over.name}.example.com/v1`,
  keyName: "GATEWAY_KEY_A",
  models: [],
  prefixes: [],
  priority: 10,
  timeoutMs: 30_000,
  enabled: true,
  ...over,
});

describe("resolveChain", () => {
  const exact = upstream({ name: "exact", models: ["gpt-5"], priority: 50 });
  const prefix = upstream({ name: "prefix", prefixes: ["gpt-"], priority: 1 });

  test("an exact model listing beats a prefix match on a higher-priority upstream", () => {
    // A prefix is a catch-all; an exact listing is a statement. Priority only breaks ties
    // *within* a tier, or a specialist would lose to whatever claimed the whole family.
    expect(resolveChain("gpt-5", [prefix, exact], {}).map((t) => t.upstream.name)).toEqual(["exact", "prefix"]);
  });

  test("priority orders within a tier, and names break ties deterministically", () => {
    const a = upstream({ name: "bravo", prefixes: ["x-"], priority: 5 });
    const b = upstream({ name: "alpha", prefixes: ["x-"], priority: 5 });
    const c = upstream({ name: "charlie", prefixes: ["x-"], priority: 1 });
    const once = resolveChain("x-1", [a, b, c], {}).map((t) => t.upstream.name);
    const twice = resolveChain("x-1", [a, b, c], {}).map((t) => t.upstream.name);
    expect(once).toEqual(["charlie", "alpha", "bravo"]);
    // A fallback order that varies between requests cannot be reasoned about from a log.
    expect(twice).toEqual(once);
  });

  test("a disabled upstream never appears", () => {
    expect(resolveChain("gpt-5", [upstream({ name: "off", models: ["gpt-5"], enabled: false })], {})).toEqual([]);
  });

  test("an unknown model resolves to nothing, which is a 404 and not a 500", () => {
    expect(resolveChain("nope", [exact], {})).toEqual([]);
  });

  test("aliases chain, and a cycle returns nothing rather than hanging", () => {
    expect(resolveAlias("a", { a: "b", b: "c", c: "gpt-5" })).toBe("gpt-5");
    expect(resolveAlias("a", { a: "b", b: "a" })).toBeNull();
    expect(resolveChain("a", [exact], { a: "b", b: "a" })).toEqual([]);
  });

  test("an alias resolves through to the upstream that serves its target", () => {
    const chain = resolveChain("house-model", [exact], { "house-model": "gpt-5" });
    expect(chain).toHaveLength(1);
    // The upstream is asked for the concrete id, not the alias it has never heard of.
    expect(chain[0]!.model).toBe("gpt-5");
  });
});

describe("catalog", () => {
  const openai = upstream({ name: "openai", models: ["gpt-5"] });

  test("aliases are listed as first-class ids", () => {
    const ids = catalog([openai], { "jarvis-default": "gpt-5" }).map((entry) => entry.id);
    expect(ids).toContain("gpt-5");
    expect(ids).toContain("jarvis-default");
  });

  test("an alias no enabled upstream can serve is not advertised", () => {
    const ids = catalog([openai], { orphan: "claude-x" }).map((entry) => entry.id);
    expect(ids).not.toContain("orphan");
  });

  test("nothing about the routing config leaks through discovery", () => {
    const json = JSON.stringify(catalog([openai], { "jarvis-default": "gpt-5" }));
    expect(json).not.toMatch(/https?:/);
    expect(json).not.toMatch(/GATEWAY_KEY/);
  });

  test("created is stable, so the response stays cacheable", () => {
    expect(catalog([openai], {})[0]!.created).toBe(catalog([openai], {})[0]!.created);
  });
});

describe("classifyUpstream", () => {
  test("an upstream 401 becomes a 502, never a 401", () => {
    // Passing it through would make every OpenAI client tell the user that *their* key is
    // invalid, and would send the TUI off to re-pair a device that is perfectly fine.
    const failure = classifyUpstream(401, "invalid api key", null);
    expect(failure.status).toBe(502);
    expect(failure.code).toBe("upstream_error");
    expect(failure.upstreamStatus).toBe(401);
  });

  test("403 is treated the same way", () => {
    expect(classifyUpstream(403, "forbidden", null).status).toBe(502);
  });

  test("429 carries a retry-after, falling back to 60 when the header is junk", () => {
    expect(classifyUpstream(429, "slow down", "12").retryAfter).toBe(12);
    expect(classifyUpstream(429, "slow down", "not-a-date").retryAfter).toBe(60);
    expect(classifyUpstream(429, "slow down", null).retryAfter).toBe(60);
  });

  test("capacity and transport failures retry; malformed requests do not", () => {
    for (const status of [429, 500, 502, 503, 504, 408]) {
      expect(isRetryable(classifyUpstream(status, "", null))).toBe(true);
    }
    for (const status of [400, 404, 413, 422]) {
      expect(isRetryable(classifyUpstream(status, "", null))).toBe(false);
    }
  });

  test("every code produces a non-empty message an OpenAI client can show", () => {
    for (const status of [400, 401, 404, 408, 429, 500, 503]) {
      const body = openAiErrorBody(classifyUpstream(status, "", null));
      expect(typeof body.error.message).toBe("string");
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(body.error.code.length).toBeGreaterThan(0);
    }
  });

  test("credentials echoed back by an upstream are redacted", () => {
    expect(redactSecrets("bad key sk-live-abcd1234efgh")).not.toContain("sk-live-abcd1234efgh");
    expect(redactSecrets("Authorization: Bearer jvd_xyz123456789")).not.toContain("jvd_xyz123456789");
    expect(classifyUpstream(500, "rejected sk-live-abcd1234efgh", null).message).toContain("«redacted»");
  });

  test("a mid-stream failure ends with [DONE] so the client's loop terminates", () => {
    const frames = sseErrorFrames(classifyUpstream(500, "boom", null));
    expect(frames.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(frames.startsWith("data: {")).toBe(true);
  });
});

describe("headers", () => {
  test("nothing from the client reaches the upstream, least of all its bearer token", () => {
    const headers = upstreamHeaders(upstream({ name: "u" }), "sk-owner-key");
    expect(headers.get("authorization")).toBe("Bearer sk-owner-key");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-evil")).toBeNull();
    // Forwarding this would hand a JARVIS device token to OpenAI.
    expect(headers.get("authorization")).not.toContain("jvd_");
  });

  test("static upstream headers are applied", () => {
    const headers = upstreamHeaders(upstream({ name: "u", headers: { "anthropic-version": "2023-06-01" } }), "k");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });

  test("upstream identity and quota headers are stripped on the way back", () => {
    const from = new Headers({
      "content-type": "application/json",
      "set-cookie": "a=b",
      "www-authenticate": "Bearer",
      "openai-organization": "org_1",
      "ratelimit-remaining": "3",
      "cf-ray": "abc",
      connection: "keep-alive",
    });
    const out = clientHeaders(from, "openai", false);
    for (const dropped of ["set-cookie", "www-authenticate", "openai-organization", "ratelimit-remaining", "cf-ray"]) {
      expect(out.get(dropped)).toBeNull();
    }
    expect(out.get("content-type")).toBe("application/json");
    expect(out.get("x-gateway-upstream")).toBe("openai");
  });

  test("a stream gets the headers that stop a proxy from buffering it", () => {
    const out = clientHeaders(new Headers(), "openai", true);
    expect(out.get("content-type")).toContain("text/event-stream");
    expect(out.get("cache-control")).toContain("no-transform");
    // The one that stops nginx holding the whole completion until it ends.
    expect(out.get("x-accel-buffering")).toBe("no");
  });
});

describe("usage metering", () => {
  const frame = (input: number, output: number) =>
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: input, completion_tokens: output } })}`;

  test("[DONE] and keepalive comments are not usage", () => {
    expect(usageFromSseEvent("data: [DONE]")).toBeNull();
    expect(usageFromSseEvent(": ping")).toBeNull();
    expect(usageFromSseEvent('data: {"choices":[{"delta":{"content":"hi"}}]}')).toBeNull();
  });

  test("a real usage frame is read", () => {
    expect(usageFromSseEvent(frame(120, 34))).toEqual({ inputTokens: 120, outputTokens: 34 });
  });

  test("usage survives an event split across two pushes mid-JSON", () => {
    // This is the failure that actually happens in production: a network chunk boundary lands
    // inside the JSON, and without buffering the usage frame is silently lost on exactly the
    // long completions that cost the most.
    const whole = `${frame(1000, 500)}\n\ndata: [DONE]\n\n`;
    const cut = Math.floor(whole.length / 2);
    const sniffer = makeUsageSniffer({ input: 1, output: 2 });
    sniffer.push(whole.slice(0, cut));
    sniffer.push(whole.slice(cut));
    expect(sniffer.result().usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
  });

  test("two events in one push are both parsed, and the last total wins", () => {
    const sniffer = makeUsageSniffer();
    sniffer.push(`${frame(1, 1)}\n\n${frame(9, 9)}\n\n`);
    expect(sniffer.result().usage).toEqual({ inputTokens: 9, outputTokens: 9 });
  });

  test("a final event with no trailing blank line is still counted", () => {
    const sniffer = makeUsageSniffer();
    sniffer.push(frame(7, 3));
    expect(sniffer.result().usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  test("a stream with no usage frame meters as nothing rather than as zero cost", () => {
    const sniffer = makeUsageSniffer({ input: 1, output: 1 });
    sniffer.push('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n');
    expect(sniffer.result().usage).toBeNull();
  });

  test("cost is integer micros, and the 1e6 conversion cancels exactly", () => {
    expect(costMicros({ inputTokens: 1_000_000, outputTokens: 0 }, { input: 2.5, output: 10 })).toBe(2_500_000);
    expect(costMicros({ inputTokens: 0, outputTokens: 1_000_000 }, { input: 2.5, output: 10 })).toBe(10_000_000);
    expect(Number.isInteger(costMicros({ inputTokens: 333, outputTokens: 777 }, { input: 0.15, output: 0.6 }))).toBe(true);
  });

  test("an upstream with no price list costs nothing, and the caller marks it estimated", () => {
    expect(costMicros({ inputTokens: 100, outputTokens: 100 })).toBe(0);
  });
});
