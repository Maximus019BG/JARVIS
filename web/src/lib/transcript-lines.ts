/**
 * Parses a TUI session's raw JSONL into something renderable.
 *
 * A port rather than a reuse: `tui/src/agent/session.ts` touches `node:fs` and `Bun.Glob`
 * at module scope, and the TUI's renderers emit @opentui elements, not DOM.
 *
 * Compacted history is kept. The dropped messages are still in the file — only the model's
 * working view shrank — and the point of reading a transcript is the full record.
 */
export type TranscriptEntry =
  | { kind: "message"; role: "user" | "assistant"; text: string; calls: number }
  | { kind: "compact"; summary: string; dropped: number };

type Part = { type?: string; text?: string };
type Line = {
  type?: string;
  header?: { title?: string; cwd?: string; created?: number };
  message?: { role?: string; content?: string | Part[] };
  summary?: string;
  dropped?: number;
};

/** Text parts joined; tool calls are counted, not rendered. Mirrors the TUI's `textOf`. */
function textOf(content: string | Part[] | undefined): { text: string; calls: number } {
  if (typeof content === "string") return { text: content, calls: 0 };
  if (!Array.isArray(content)) return { text: "", calls: 0 };
  let calls = 0;
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
    else if (part.type === "tool-call") calls++;
  }
  return { text: parts.join("").trim(), calls };
}

export function transcriptLines(jsonl: string): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      // A truncated last line is normal for a file that was being appended to.
      continue;
    }
    if (line.type === "compact") {
      out.push({ kind: "compact", summary: line.summary ?? "", dropped: line.dropped ?? 0 });
      continue;
    }
    if (line.type !== "message" || !line.message) continue;
    const role = line.message.role;
    if (role !== "user" && role !== "assistant") continue;
    const { text, calls } = textOf(line.message.content);
    // A turn that was pure tool calls still deserves a row — dropping it would make the
    // agent look idle for the part of the session where it did the most work.
    if (!text && calls === 0) continue;
    out.push({ kind: "message", role, text, calls });
  }
  return out;
}
