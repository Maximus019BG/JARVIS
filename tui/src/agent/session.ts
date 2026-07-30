import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { ModelMessage } from "ai"
import { sessionDir } from "../config/paths.ts"

export type SessionHeader = {
  id: string
  cwd: string
  created: number
  title: string
}

export type Session = SessionHeader & { messages: ModelMessage[] }

/**
 * Sessions are append-only JSONL: a header line, then one line per message. That
 * makes writes cheap during a turn and keeps a half-written session readable.
 */
type Line = { type: "header"; header: SessionHeader } | { type: "message"; message: ModelMessage }

const path = (id: string) => join(sessionDir, `${id}.jsonl`)

function ensureDir() {
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true })
}

function newID(): string {
  return `ses_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** First line of the first user message, used as the session's label. */
export function deriveTitle(messages: ModelMessage[]): string {
  const first = messages.find((message) => message.role === "user")
  if (!first) return "untitled"
  const text =
    typeof first.content === "string"
      ? first.content
      : first.content
          .map((part) => ("text" in part ? part.text : ""))
          .join(" ")
          .trim()
  const line = text.split("\n").find((l) => l.trim()) ?? "untitled"
  return line.length > 72 ? `${line.slice(0, 71)}…` : line
}

export function createSession(cwd: string): Session {
  ensureDir()
  const header: SessionHeader = { id: newID(), cwd, created: Date.now(), title: "untitled" }
  writeFileSync(path(header.id), `${JSON.stringify({ type: "header", header } satisfies Line)}\n`)
  return { ...header, messages: [] }
}

/** Appends to the session file and mutates `session.messages` to match. */
export function appendMessages(session: Session, messages: ModelMessage[]) {
  if (messages.length === 0) return
  ensureDir()
  const lines = messages.map((message) => JSON.stringify({ type: "message", message } satisfies Line))
  appendFileSync(path(session.id), `${lines.join("\n")}\n`)
  session.messages.push(...messages)
  if (session.title === "untitled") {
    const title = deriveTitle(session.messages)
    if (title !== "untitled") setTitle(session, title)
  }
}

/** Rewrites the header line in place; the message lines after it are untouched. */
export function setTitle(session: Session, title: string) {
  session.title = title
  const file = path(session.id)
  if (!existsSync(file)) return
  const lines = readFileSync(file, "utf8").split("\n")
  lines[0] = JSON.stringify({ type: "header", header: header(session) } satisfies Line)
  writeFileSync(file, lines.join("\n"))
}

const header = ({ id, cwd, created, title }: Session): SessionHeader => ({ id, cwd, created, title })

export function loadSession(id: string): Session {
  const file = path(id)
  if (!existsSync(file)) throw new Error(`session not found: ${id}`)
  const messages: ModelMessage[] = []
  let found: SessionHeader | undefined
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw.trim()) continue
    const line = JSON.parse(raw) as Line
    if (line.type === "header") found = line.header
    else messages.push(line.message)
  }
  if (!found) throw new Error(`session ${id} has no header`)
  return { ...found, messages }
}

/** Session headers, newest first. Pass `cwd` to only list sessions from there. */
export function listSessions(cwd?: string): SessionHeader[] {
  if (!existsSync(sessionDir)) return []
  const found: { header: SessionHeader; mtime: number }[] = []
  for (const file of new Bun.Glob("*.jsonl").scanSync({ cwd: sessionDir, onlyFiles: true })) {
    const full = join(sessionDir, file)
    try {
      const firstLine = readFileSync(full, "utf8").split("\n", 1)[0]!
      const line = JSON.parse(firstLine) as Line
      if (line.type !== "header") continue
      if (cwd && line.header.cwd !== cwd) continue
      found.push({ header: line.header, mtime: statSync(full).mtimeMs })
    } catch {
      // a truncated or hand-edited session file should not break the picker
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((entry) => entry.header)
}

export function latestSession(cwd: string): Session | undefined {
  const newest = listSessions(cwd)[0]
  return newest ? loadSession(newest.id) : undefined
}

/** Resolves the session to work in from the `--continue` / `--session` flags. */
export function openSession(cwd: string, options: { id?: string; resume?: boolean }): Session {
  if (options.id) return loadSession(options.id)
  if (options.resume) return latestSession(cwd) ?? createSession(cwd)
  return createSession(cwd)
}
