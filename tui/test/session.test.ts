import { describe, expect, test } from "bun:test"
import { appendMessages, createSession, deriveTitle, listSessions, loadSession, openSession } from "../src/session.ts"

const cwd = `/tmp/jarvis-session-test-${Math.random().toString(36).slice(2)}`

describe("sessions", () => {
  test("round-trip through the JSONL file", () => {
    const session = createSession(cwd)
    appendMessages(session, [
      { role: "user", content: "first line\nsecond line" },
      { role: "assistant", content: "ok" },
    ])
    const loaded = loadSession(session.id)
    expect(loaded.messages).toHaveLength(2)
    expect(loaded.cwd).toBe(cwd)
    expect(loaded.title).toBe("first line")
  })

  test("lists newest first and filters by directory", () => {
    const a = createSession(cwd)
    const b = createSession(cwd)
    createSession(`${cwd}-other`)
    const ids = listSessions(cwd).map((s) => s.id)
    expect(ids).toContain(a.id)
    expect(ids[0]).toBe(b.id)
    expect(listSessions(`${cwd}-other`).map((s) => s.id)).not.toContain(a.id)
  })

  test("--continue reuses the newest session, otherwise a fresh one is made", () => {
    const existing = createSession(cwd)
    expect(openSession(cwd, { resume: true }).id).toBe(existing.id)
    expect(openSession(cwd, {}).id).not.toBe(existing.id)
    expect(openSession(cwd, { id: existing.id }).id).toBe(existing.id)
  })

  test("titles come from the first user message, structured or not", () => {
    expect(deriveTitle([{ role: "assistant", content: "hi" }])).toBe("untitled")
    expect(deriveTitle([{ role: "user", content: [{ type: "text", text: "  do the thing  " }] }])).toBe("do the thing")
    expect(deriveTitle([{ role: "user", content: "x".repeat(100) }])).toHaveLength(72)
  })
})
