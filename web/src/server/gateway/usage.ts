export type TokenUsage = { inputTokens: number; outputTokens: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0);

/**
 * Token counts out of a completion body's `usage` block. Accepts both the OpenAI spelling
 * (`prompt_tokens`/`completion_tokens`) and the AI-SDK-ish one, since compatible endpoints
 * differ and a missed field means an unbilled request.
 */
export function usageFromJson(body: unknown): TokenUsage | null {
  if (!isRecord(body)) return null;
  const usage = isRecord(body.usage) ? body.usage : body;
  const input = count(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens);
  const output = count(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens);
  if (input === 0 && output === 0) return null;
  return { inputTokens: input, outputTokens: output };
}

/**
 * Token counts out of one SSE event's text. Returns null for `[DONE]`, for comment lines, and for
 * the overwhelming majority of chunks, which carry only a delta.
 */
export function usageFromSseEvent(event: string): TokenUsage | null {
  for (const line of event.split("\n")) {
    const trimmed = line.trim();
    // `:` opens a comment — some providers send `: ping` as a keepalive.
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "" || payload === "[DONE]") continue;
    try {
      const found = usageFromJson(JSON.parse(payload));
      if (found) return found;
    } catch {
      // A chunk that is not JSON is not a usage frame. Nothing to do about it here.
    }
  }
  return null;
}

/**
 * USD-per-million-tokens in, integer micros out.
 *
 * The two factors of 1e6 cancel — `tokens / 1e6 * usdPerMillion * 1e6 === tokens * usdPerMillion`
 * — so this is one multiply and one round at the boundary. Money never accumulates as a float,
 * which is how you end up with $0.30000000000000004.
 */
export function costMicros(usage: TokenUsage, cost?: { input: number; output: number }): number {
  if (!cost) return 0;
  return Math.round(usage.inputTokens * cost.input + usage.outputTokens * cost.output);
}

/**
 * Watches a stream go past and reports what it cost.
 *
 * Stateful, but with no I/O and no network, so it unit-tests like a pure function.
 *
 * Buffers partial events on purpose: a network chunk boundary lands in the middle of the JSON
 * often enough that not buffering would silently lose the usage frame on exactly the long
 * completions that cost the most.
 */
export function makeUsageSniffer(cost?: { input: number; output: number }): {
  push: (text: string) => void;
  result: () => { usage: TokenUsage | null; costMicros: number };
} {
  let buffer = "";
  let usage: TokenUsage | null = null;

  return {
    push(text: string) {
      buffer += text;
      // SSE events are separated by a blank line. Everything after the last separator may be a
      // fragment, so it stays in the buffer for the next chunk.
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const found = usageFromSseEvent(event);
        // Last one wins: the final frame is the authoritative total, and an intermediate one
        // would undercount.
        if (found) usage = found;
      }
    },
    result() {
      // The tail may hold a complete final event that never got its trailing blank line.
      const tail = buffer.length > 0 ? usageFromSseEvent(buffer) : null;
      const total = tail ?? usage;
      return { usage: total, costMicros: total ? costMicros(total, cost) : 0 };
    },
  };
}
