import { classifyUpstream, redactSecrets, type GatewayFailure } from "./errors";
import { upstreamHeaders } from "./headers";
import type { ResolvedTarget } from "./resolve";
import { LIMITS } from "./upstreams";

export type Attempt =
  | { ok: true; response: Response; target: ResolvedTarget; ms: number }
  | { ok: false; failure: GatewayFailure; target: ResolvedTarget };

/**
 * One call to one upstream.
 *
 * The client's own abort signal is forwarded: a cancelled TUI turn should stop the meter running
 * upstream, not just hang up locally and keep paying for tokens nobody will read.
 */
export async function callUpstream(
  target: ResolvedTarget,
  apiKey: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Attempt> {
  const started = Date.now();
  const timeout = AbortSignal.timeout(target.upstream.timeoutMs);

  const streaming = payload.stream === true;
  const requested = Number(payload.max_tokens ?? payload.max_completion_tokens ?? LIMITS.maxOutputTokens);
  const body: Record<string, unknown> = {
    ...payload,
    model: target.model,
    // Clamped server-side. A client asking for 200k output tokens is a cost incident, and the
    // owner's key is the one paying for it.
    max_tokens: Math.min(Number.isFinite(requested) ? requested : LIMITS.maxOutputTokens, LIMITS.maxOutputTokens),
    // Without this OpenAI sends no usage frame on a stream at all, and metering records zero for
    // every streamed turn. The client sees one extra final chunk carrying `usage`, which OpenAI
    // SDKs and the AI SDK both tolerate; the alternative is billing nothing.
    ...(streaming ? { stream_options: { include_usage: true, ...(payload.stream_options as object) } } : {}),
  };

  try {
    const response = await fetch(`${target.upstream.baseUrl}/chat/completions`, {
      method: "POST",
      headers: upstreamHeaders(target.upstream, apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, timeout]),
    });

    if (!response.ok) {
      // Safe to read: an error body is small. A 2xx body is the stream and must not be touched.
      const text = await response.text().catch(() => "");
      return { ok: false, failure: classifyUpstream(response.status, text, response.headers.get("retry-after")), target };
    }
    return { ok: true, response, target, ms: Date.now() - started };
  } catch (error) {
    // The client hanging up is not an upstream fault, and must not be retried against another.
    if (signal.aborted) {
      return { ok: false, failure: { status: 499, code: "invalid_request", message: "client closed the request" }, target };
    }
    if (timeout.aborted) {
      return {
        ok: false,
        failure: { status: 504, code: "upstream_timeout", message: `no response within ${target.upstream.timeoutMs}ms` },
        target,
      };
    }
    return {
      ok: false,
      failure: {
        status: 502,
        code: "upstream_error",
        message: redactSecrets(error instanceof Error ? error.message : String(error)),
      },
      target,
    };
  }
}
