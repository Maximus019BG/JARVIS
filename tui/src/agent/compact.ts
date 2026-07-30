import { generateText, type ModelMessage } from "ai"
import type { Config } from "../config/config.ts"
import { appendCompact, lastTurnStart, type Session } from "./session.ts"
import { defaultModelID, resolveModel } from "./provider.ts"

/**
 * Sections rather than a paragraph. A flat summary loses the two things that actually
 * matter to the next turn — which files were already changed and what is still open — and
 * an agent that forgets what it already did repeats the work.
 */
const PROMPT = [
  "Summarize this coding session for an agent that will continue it with no other context.",
  "Use exactly these sections, and nothing else:",
  "",
  "## Goal — what the user is trying to accomplish, in their words",
  "## Files changed — path: what changed and why",
  "## Files read — path: what matters in it",
  "## Decisions — choices made and options rejected, with reasons",
  "## Open — what is unfinished, what failed, and the immediate next step",
  "",
  "Be specific: exact identifiers, paths, commands and error text.",
  "Write nothing that is not in the transcript. Do not editorialize or congratulate.",
].join("\n")

/** How much of one tool's input or output survives into the transcript we summarize. */
const CLIP = 600

function clip(text: string, max = CLIP): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * The history as plain text for the summarizer. Tool calls are included with their
 * arguments, because "which files changed" lives in the `edit` and `write` inputs and a
 * text-only flatten would throw exactly that away.
 */
export function render(messages: ModelMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    const content = message.content
    if (typeof content === "string") {
      if (content.trim()) lines.push(`${message.role}: ${clip(content)}`)
      continue
    }
    for (const part of content) {
      if (part.type === "text" && part.text.trim()) lines.push(`${message.role}: ${clip(part.text)}`)
      else if (part.type === "tool-call") lines.push(`tool ${part.toolName}(${clip(JSON.stringify(part.input))})`)
      else if (part.type === "tool-result") lines.push(`  -> ${clip(JSON.stringify(part.output))}`)
    }
  }
  return lines.join("\n")
}

export class NothingToCompact extends Error {
  constructor() {
    super("nothing to compact yet — there is only one turn of history")
  }
}

/**
 * Summarizes everything before the current turn and rewrites the session to match.
 * Returns how many messages the model no longer has to carry.
 */
export async function compactSession(config: Config, session: Session): Promise<{ summary: string; dropped: number }> {
  const start = lastTurnStart(session.messages)
  if (start === 0) throw new NothingToCompact()

  // The small model exists for exactly this: a cheap, mechanical pass over a transcript.
  const model = await resolveModel(config, config.smallModel ?? defaultModelID(config))
  const { text } = await generateText({
    model: model.model,
    system: PROMPT,
    messages: [{ role: "user", content: render(session.messages.slice(0, start)) }],
  })
  const summary = text.trim()
  if (!summary) throw new Error("the summarizer returned nothing; history left untouched")

  return { summary, dropped: appendCompact(session, summary) }
}

/**
 * A short label for the session, from the same cheap model. The fallback — the first line
 * of the first message — is a fine label for "fix the login bug" and a useless one for a
 * pasted stack trace.
 */
export async function generateTitle(config: Config, messages: ModelMessage[]): Promise<string> {
  const model = await resolveModel(config, config.smallModel ?? defaultModelID(config))
  const { text } = await generateText({
    model: model.model,
    system: "Title this coding session in at most six words. Reply with the title only: no quotes, no final period.",
    messages: [{ role: "user", content: clip(render(messages)) }],
  })
  return text.trim().split("\n")[0]?.slice(0, 72) ?? ""
}

/** Provider errors that mean "the history no longer fits", which compaction can fix. */
const OVERFLOW = /context|too many tokens|maximum.*(context|length)|prompt is too long|reduce the length/i

export function isOverflow(error: unknown): boolean {
  return OVERFLOW.test(error instanceof Error ? error.message : String(error))
}
