import type { Upstream } from "./upstreams";

/**
 * Header handling, allowlisted in both directions.
 *
 * Allowlists rather than a hop-by-hop denylist: a denylist is one upstream release away from
 * leaking a header nobody thought to name. Nothing crosses this boundary unless it is listed
 * here.
 */

/**
 * What an upstream sees. Built from scratch — no header from the client's request reaches it.
 *
 * In particular the client's `Authorization: Bearer jvd_…` is **never** forwarded. Forwarding it
 * would hand a JARVIS device token to OpenAI, which is both a credential leak and useless to
 * them. The upstream gets the owner's key and nothing else.
 */
export function upstreamHeaders(upstream: Upstream, apiKey: string): Headers {
  const headers = new Headers({
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  for (const [key, value] of Object.entries(upstream.headers ?? {})) headers.set(key, value);
  return headers;
}

/**
 * What the client sees. `content-type` from the upstream so a stream stays a stream, plus our own
 * diagnostics.
 *
 * Dropped on purpose: `set-cookie` and `www-authenticate` (an upstream must not set state or
 * challenge in our name), `openai-*` / `anthropic-*` organisation identifiers, `ratelimit-*` (the
 * owner's quota is not the device's business, and exposing it leaks account scale), every `cf-*`,
 * and all hop-by-hop headers, whose values describe a connection that ends here.
 */
export function clientHeaders(upstream: Headers, upstreamName: string, streaming: boolean): Headers {
  const contentType = upstream.get("content-type");
  const headers = new Headers({
    "content-type": streaming ? "text/event-stream; charset=utf-8" : (contentType ?? "application/json"),
    "x-gateway-upstream": upstreamName,
  });
  if (streaming) {
    // `no-transform` stops a proxy from re-encoding the body, and `x-accel-buffering: no` is the
    // one that stops nginx holding the whole completion until it ends. Without them the symptom
    // is "the answer arrives all at once", which reads as a code bug and is not one.
    headers.set("cache-control", "no-cache, no-transform");
    headers.set("connection", "keep-alive");
    headers.set("x-accel-buffering", "no");
  }
  return headers;
}
