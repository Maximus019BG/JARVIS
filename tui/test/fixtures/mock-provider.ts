import { MockLanguageModelV4, simulateReadableStream } from "ai/test"

export type MockPart =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "error"; error: unknown }

/**
 * One entry per model round trip. The agent loop calls the model once per step,
 * so a tool call in step 0 and text in step 1 is the shape of a normal turn.
 */
declare global {
  var mockSteps: MockPart[][]
  var mockCalls: unknown[]
}

function chunks(parts: MockPart[]) {
  const out: unknown[] = [{ type: "stream-start", warnings: [] }]
  for (const [index, part] of parts.entries()) {
    if (part.type === "text") {
      const id = `t${index}`
      out.push({ type: "text-start", id }, { type: "text-delta", id, delta: part.text }, { type: "text-end", id })
    } else if (part.type === "tool") {
      out.push({ type: "tool-call", toolCallId: part.id, toolName: part.name, input: JSON.stringify(part.input) })
    } else {
      out.push({ type: "error", error: part.error })
    }
  }
  const finishReason = parts.some((p) => p.type === "tool") ? "tool-calls" : "stop"
  // LanguageModelV4Usage nests the counts; the `ai` layer flattens them for us.
  out.push({ type: "finish", finishReason, usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } } })
  return out
}

/** Discovered by provider.ts the same way a real `@ai-sdk/*` package would be. */
export function createMock() {
  return (modelId: string) =>
    new MockLanguageModelV4({
      provider: "mock",
      modelId,
      doStream: async (options) => {
        globalThis.mockCalls.push(options)
        const parts = globalThis.mockSteps.shift() ?? [{ type: "text" as const, text: "done" }]
        return { stream: simulateReadableStream({ chunks: chunks(parts) as never[], chunkDelayInMs: null }) }
      },
    })
}
