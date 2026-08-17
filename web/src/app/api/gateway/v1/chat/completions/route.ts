import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDevice } from "~/server/device-auth";
import {
  failureHeaders,
  isRetryable,
  openAiErrorBody,
  sseErrorFrames,
  type GatewayFailure,
} from "~/server/gateway/errors";
import { clientHeaders } from "~/server/gateway/headers";
import { gatewayEnabled, keyFor } from "~/server/gateway/keys";
import { checkLimits, reserveUsage, settleUsage } from "~/server/gateway/meter";
import { callUpstream } from "~/server/gateway/proxy";
import { resolveChain } from "~/server/gateway/resolve";
import { LIMITS } from "~/server/gateway/upstreams";
import { makeUsageSniffer, usageFromJson } from "~/server/gateway/usage";

/**
 * Stated rather than inherited. Every line below assumes Node: WHATWG streams with a `flush`
 * hook, `postgres-js`, and `node:crypto` by way of device-auth. If the project default ever
 * changes, this file should break at build time rather than silently on another runtime.
 */
export const runtime = "nodejs";
/** A per-device token stream must never be statically analysed or cached. */
export const dynamic = "force-dynamic";
/**
 * A long completion outruns the 15s platform default. A no-op under self-hosted `next start`,
 * which is exactly why each upstream's `timeoutMs` and `LIMITS.totalDeadlineMs` are enforced in
 * code as well — this is the platform's ceiling, not the gateway's.
 */
export const maxDuration = 300;

/** A chat request with base64 images is large, but not transcript-large. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const messageSchema = z.looseObject({
  role: z.enum(["system", "developer", "user", "assistant", "tool", "function"]),
  content: z.unknown().optional(),
});

/**
 * Loose at every level, on purpose. An OpenAI-compatible gateway that 400s on a parameter it has
 * not heard of is not compatible — new ones ship monthly and have to pass straight through. Only
 * the fields with a cost or safety consequence are constrained.
 */
const bodySchema = z.looseObject({
  model: z.string().min(1).max(200),
  messages: z.array(messageSchema).min(1).max(2000),
  stream: z.boolean().default(false),
  stream_options: z.looseObject({ include_usage: z.boolean().optional() }).optional(),
  max_tokens: z.number().int().positive().max(200_000).optional(),
  max_completion_tokens: z.number().int().positive().max(200_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  /** Fan-out multiplies cost with no visible signal. One completion per request. */
  n: z.literal(1).optional(),
  tools: z.array(z.unknown()).max(256).optional(),
  tool_choice: z.unknown().optional(),
  response_format: z.unknown().optional(),
  user: z.string().max(256).optional(),
});

/** Every failure on this path answers OpenAI-shaped, so a generic client can show the message. */
const fail = (failure: GatewayFailure) =>
  new NextResponse(JSON.stringify(openAiErrorBody(failure)), {
    status: failure.status,
    headers: failureHeaders(failure),
  });

export async function POST(request: Request) {
  if (!gatewayEnabled()) {
    return fail({ status: 503, code: "gateway_disabled", message: "this gateway is not enabled" });
  }

  const authed = await authenticateDevice(request);
  // Left exactly as device-auth wrote it: `{ error: "Unauthorized" }` with a 401 is what every
  // other device route answers, and an OpenAI client shows a usable "401 Unauthorized" anyway.
  if (authed instanceof NextResponse) return authed;
  const { device } = authed;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return fail({ status: 413, code: "invalid_request", message: `body exceeds ${MAX_BODY_BYTES} bytes` });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return fail({ status: 413, code: "invalid_request", message: `body exceeds ${MAX_BODY_BYTES} bytes` });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(raw));
  } catch (error) {
    return fail({
      status: 400,
      code: "invalid_request",
      message: error instanceof z.ZodError ? JSON.stringify(error.issues.slice(0, 5)) : String(error),
    });
  }

  const limited = await checkLimits(device.userId, device.id);
  if (limited) return fail(limited);

  const chain = resolveChain(body.model);
  if (chain.length === 0) {
    return fail({ status: 404, code: "model_not_found", message: `no upstream serves "${body.model}"` });
  }

  const usageId = await reserveUsage({
    userId: device.userId,
    deviceId: device.id,
    workstationId: device.workstationId,
    requestedModel: body.model,
    streamed: body.stream,
  });

  const deadline = Date.now() + LIMITS.totalDeadlineMs;
  let last: GatewayFailure = { status: 502, code: "gateway_misconfigured", message: "no upstream was reachable" };
  let attempts = 0;

  for (const target of chain.slice(0, LIMITS.maxAttempts)) {
    if (Date.now() > deadline) break;
    const apiKey = keyFor(target.upstream.keyName);
    // An upstream the owner has not given a key to is skipped, not fatal: a half-configured
    // routing table should still serve what it can.
    if (!apiKey) continue;

    attempts += 1;
    const attempt = await callUpstream(target, apiKey, body, request.signal);

    if (attempt.ok) {
      return body.stream
        ? streamBack(attempt.response, target, usageId, attempts)
        : await jsonBack(attempt.response, target, usageId, attempts, attempt.ms);
    }

    last = attempt.failure;
    if (!isRetryable(attempt.failure)) break;
  }

  await settleUsage(usageId, {
    status: last.code === "upstream_timeout" ? "upstream_timeout" : attempts === 0 ? "rejected" : "upstream_error",
    upstreamStatus: last.upstreamStatus,
    attempts: Math.max(1, attempts),
  });
  return fail(last);
}

/** A non-streaming completion. The body is small enough to read, so metering is exact. */
async function jsonBack(
  response: Response,
  target: Parameters<typeof settleUsage>[1]["target"],
  usageId: string,
  attempts: number,
  ms: number,
) {
  const text = await response.text();
  let usage = null;
  try {
    usage = usageFromJson(JSON.parse(text));
  } catch {
    // A 2xx that is not JSON is the upstream's problem, and the client can see it verbatim.
  }
  await settleUsage(usageId, { status: "ok", target, usage, upstreamStatus: response.status, latencyMs: ms, attempts });
  return new NextResponse(text, { status: 200, headers: clientHeaders(response.headers, target!.upstream.name, false) });
}

/**
 * A streamed completion, passed through byte for byte while a sniffer reads a copy.
 *
 * One `TransformStream`, not `response.body.tee()`: tee gives two branches that both have to be
 * drained or the internal buffer grows without bound, which under a slow client is unbounded
 * memory for the length of the completion. One consumer has no such failure mode.
 */
function streamBack(
  response: Response,
  target: NonNullable<Parameters<typeof settleUsage>[1]["target"]>,
  usageId: string,
  attempts: number,
) {
  const upstream = response.body;
  if (!upstream) {
    const failure: GatewayFailure = { status: 502, code: "upstream_error", message: "upstream sent no body" };
    void settleUsage(usageId, { status: "upstream_error", target, attempts });
    return fail(failure);
  }

  const decoder = new TextDecoder();
  const sniffer = makeUsageSniffer(target.upstream.cost);
  const started = Date.now();

  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Client first, always. Metering must not sit in the latency path of a token.
      controller.enqueue(chunk);
      try {
        sniffer.push(decoder.decode(chunk, { stream: true }));
      } catch {
        // Never let bookkeeping break a stream the reader is already watching.
      }
    },
    async flush(controller) {
      const { usage } = sniffer.result();
      await settleUsage(usageId, {
        status: "ok",
        target,
        usage,
        upstreamStatus: response.status,
        latencyMs: Date.now() - started,
        attempts,
      });
      void controller;
    },
  });

  // Once a 200 and its headers are on the wire the status is spent, so a failure from here on can
  // only be delivered inside the stream. And it must NOT be retried against another upstream:
  // partial content has already been sent, and splicing two half-completions together would
  // render as nonsense.
  const piped = upstream.pipeThrough(meter);
  const guarded = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = piped.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (error) {
        const failure: GatewayFailure = {
          status: 502,
          code: "upstream_error",
          message: error instanceof Error ? error.message : String(error),
        };
        controller.enqueue(new TextEncoder().encode(sseErrorFrames(failure)));
        await settleUsage(usageId, { status: "upstream_error", target, attempts });
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  // `new Response`, not NextResponse.json: the happy path has no JSON body to hand it.
  return new Response(guarded, { status: 200, headers: clientHeaders(response.headers, target.upstream.name, true) });
}
