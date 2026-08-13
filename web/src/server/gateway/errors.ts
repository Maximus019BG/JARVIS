/**
 * Failure classification and the two wire formats for it.
 *
 * Note on conventions: src/lib/api/error.ts says every route in this app answers failures as
 * `{ error: "..." }`. The /api/gateway/v1/** paths deliberately do not, because every OpenAI
 * client reads `error.message` off an OpenAI-shaped body and being compatible is the whole point
 * of the endpoint. The repo's snake_case vocabulary survives in `error.code` and in an
 * `x-gateway-error` header. Consequence: `problem()` in src/lib/api/error.ts only unwraps a
 * *string* `error`, so browser code must not use it against gateway routes.
 */

export type GatewayCode =
  | "invalid_request"
  | "rate_limited"
  | "quota_exceeded"
  | "model_not_found"
  | "upstream_error"
  | "upstream_timeout"
  | "gateway_disabled"
  | "gateway_misconfigured";

export type GatewayFailure = {
  status: number;
  code: GatewayCode;
  message: string;
  retryAfter?: number;
  /** The upstream's own status, for our logs. Never presented to the client as ours. */
  upstreamStatus?: number;
};

/** Default seconds to wait when an upstream says "later" without saying when. */
const DEFAULT_RETRY_AFTER = 60;

/**
 * Strips anything credential-shaped out of text bound for a client or a log. Upstream error
 * bodies do sometimes echo the key that was sent, and this text ends up in a message.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(?:sk|jvd|rk)[-_][A-Za-z0-9_-]{8,}/g, "«redacted»")
    .replace(/Bearer\s+\S+/gi, "Bearer «redacted»");
}

/** Reads a Retry-After header, which may be seconds or an HTTP date. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * Maps an upstream's response to our failure.
 *
 * The load-bearing rule is the 401/403 case: **an upstream rejecting the owner's key becomes a
 * 502, never a 401.** Passing it through would make every OpenAI client tell the user that
 * *their* key is invalid, and would send the TUI off to re-pair a device that is fine. The
 * owner's misconfiguration is a gateway fault, and it has to read as one.
 */
export function classifyUpstream(status: number, bodyText: string, retryAfterHeader: string | null): GatewayFailure {
  const detail = redactSecrets(bodyText.slice(0, 400).trim());

  if (status === 401 || status === 403) {
    return {
      status: 502,
      code: "upstream_error",
      message: "the gateway's upstream credential was rejected — this is a server-side misconfiguration",
      upstreamStatus: status,
    };
  }
  if (status === 429) {
    return {
      status: 429,
      code: "rate_limited",
      message: "the upstream is rate limiting",
      retryAfter: parseRetryAfter(retryAfterHeader) ?? DEFAULT_RETRY_AFTER,
      upstreamStatus: status,
    };
  }
  if (status === 404) {
    return { status: 404, code: "model_not_found", message: detail || "the upstream has no such model", upstreamStatus: status };
  }
  if (status === 408 || status === 504) {
    return { status: 504, code: "upstream_timeout", message: "the upstream timed out", upstreamStatus: status };
  }
  if (status >= 500) {
    return { status: 502, code: "upstream_error", message: detail || `upstream returned ${status}`, upstreamStatus: status };
  }
  // 400, 413, 422 and friends: the request itself is wrong, so it is ours to report as such.
  return { status: 400, code: "invalid_request", message: detail || `upstream rejected the request (${status})`, upstreamStatus: status };
}

/**
 * Whether trying the next upstream could plausibly do better.
 *
 * A malformed request will be malformed at the next upstream too, so retrying it only multiplies
 * latency and cost. Capacity and transport failures are the ones worth another attempt.
 */
export function isRetryable(failure: GatewayFailure): boolean {
  if (failure.code === "upstream_timeout") return true;
  if (failure.code === "rate_limited") return true;
  return failure.code === "upstream_error";
}

/** The OpenAI-shaped body. `error.message` is what every OpenAI SDK surfaces to a user. */
export function openAiErrorBody(failure: GatewayFailure): {
  error: { message: string; type: string; code: string; param: null };
} {
  return {
    error: {
      message: failure.message,
      type: failure.status >= 500 ? "server_error" : "invalid_request_error",
      code: failure.code,
      param: null,
    },
  };
}

/** The repo-standard body, for any gateway route a browser calls. */
export function repoErrorBody(failure: GatewayFailure): { error: string; detail?: string; retryAfter?: number } {
  return {
    error: failure.code,
    ...(failure.message ? { detail: failure.message } : {}),
    ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}),
  };
}

/**
 * A failure that has to be delivered *inside* an already-200 stream. Ends with `[DONE]` so a
 * client's stream loop terminates normally instead of hanging on a truncated body.
 */
export function sseErrorFrames(failure: GatewayFailure): string {
  return `data: ${JSON.stringify(openAiErrorBody(failure))}\n\ndata: [DONE]\n\n`;
}

/** Response headers that carry our own vocabulary alongside the OpenAI-shaped body. */
export function failureHeaders(failure: GatewayFailure): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-gateway-error": failure.code,
    ...(failure.retryAfter ? { "retry-after": String(failure.retryAfter) } : {}),
  };
}
