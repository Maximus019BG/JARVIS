import type { AgentEvent } from "../agent/agent.ts"

export type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; agent?: string }
  | { kind: "reasoning"; text: string; agent?: string }
  | {
      kind: "tool"
      id: string
      name: string
      input: unknown
      output?: string
      failed?: boolean
      agent?: string
      startedAt: number
      endedAt?: number
    }
  | Note

/** A one-line remark in the transcript: startup warnings, tool-call counts, failures. */
export type Note = { kind: "note"; text: string; level: "info" | "error" }

/**
 * Which blueprint the transcript is about, and a token that changes when it may have
 * changed on disk.
 *
 * Derived from the tool calls already in the transcript rather than plumbed through from
 * the tools: every call carries its raw input, and the last blueprint one names the
 * drawing. Nothing in the blueprint store has to know a UI exists, and there is no watcher
 * to leak. `revision` folds in `endedAt`, so a finished edit is a new token and a call
 * still running is not.
 */
export function activeBlueprint(items: readonly Item[]): { name: string; revision: string } | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (item.kind !== "tool" || !item.name.startsWith("blueprint")) continue
    const named = (item.input as { name?: unknown } | null)?.name
    if (typeof named === "string" && named) return { name: named, revision: `${item.id}:${item.endedAt ?? 0}` }
  }
  return undefined
}

/**
 * Folds a stream of agent events into the list the UI renders. Text deltas append
 * to the trailing assistant item so streaming reads as one growing block, and tool
 * results land on the card the tool call created.
 */
export function applyEvent(items: Item[], event: AgentEvent, agent?: string, now = Date.now()): Item[] {
  switch (event.type) {
    case "text": {
      const last = items[items.length - 1]
      if (last?.kind === "assistant" && last.agent === agent) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
      }
      return [...items, { kind: "assistant", text: event.text, agent }]
    }
    case "reasoning": {
      const last = items[items.length - 1]
      if (last?.kind === "reasoning" && last.agent === agent) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
      }
      return [...items, { kind: "reasoning", text: event.text, agent }]
    }
    case "tool-start":
      return [...items, { kind: "tool", id: event.id, name: event.name, input: event.input, agent, startedAt: now }]
    case "tool-end": {
      const index = items.findLastIndex((item) => item.kind === "tool" && item.id === event.id)
      if (index === -1) {
        const orphan = { kind: "tool", id: event.id, name: event.name, input: {}, startedAt: now } as const
        return [...items, { ...orphan, output: event.output, endedAt: now }]
      }
      const updated = [...items]
      updated[index] = {
        ...(items[index] as Extract<Item, { kind: "tool" }>),
        output: event.output,
        failed: event.failed,
        endedAt: now,
      }
      return updated
    }
    case "error":
      return [...items, { kind: "note", text: event.message, level: "error" }]
    case "sub":
      return applyEvent(items, event.event, event.agent, now)
    default:
      // usage does not produce a transcript item
      return items
  }
}

/** One-line preview of a tool call, e.g. `read src/app.ts`. */
export function summarize(name: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>
  for (const key of ["filePath", "path", "pattern", "command", "description", "agent"]) {
    const value = fields[key]
    if (typeof value === "string" && value.trim()) {
      const line = value.split("\n")[0]!
      return `${name} ${line.length > 80 ? `${line.slice(0, 79)}…` : line}`
    }
  }
  return name
}
