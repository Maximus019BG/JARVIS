import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ModelMessage } from "ai"
import { attach } from "../src/agent/attach.ts"
import { compactSession, isOverflow, NothingToCompact, render } from "../src/agent/compact.ts"
import { ConfigSchema } from "../src/config/config.ts"
import { appendCompact, appendMessages, createSession, lastTurnStart, loadSession } from "../src/agent/session.ts"

const cwd = `/tmp/jarvis-compact-test-${Math.random().toString(36).slice(2)}`

/** One turn: the user prompt, a tool call, its result, then the reply. */
function turn(prompt: string, file: string, reply: string): ModelMessage[] {
  return [
    { role: "user", content: prompt },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: file, toolName: "edit", input: { filePath: file } }] },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: file, toolName: "edit", output: { type: "text", value: "edited" } }],
    },
    { role: "assistant", content: reply },
  ]
}

describe("lastTurnStart", () => {
  test("finds the most recent user message", () => {
    const messages = [...turn("one", "a.ts", "did a"), ...turn("two", "b.ts", "did b")]
    expect(lastTurnStart(messages)).toBe(4)
    expect(messages[4]).toMatchObject({ role: "user", content: "two" })
  })

  test("a single turn has nothing before it to summarize", () => {
    expect(lastTurnStart(turn("one", "a.ts", "did a"))).toBe(0)
  })
})

describe("appendCompact", () => {
  test("keeps the current turn verbatim and folds the rest on reload", () => {
    const session = createSession(cwd)
    appendMessages(session, [...turn("one", "a.ts", "did a"), ...turn("two", "b.ts", "did b")])

    const dropped = appendCompact(session, "## Files changed\na.ts: did a")
    expect(dropped).toBe(4)

    for (const messages of [session.messages, loadSession(session.id).messages]) {
      // summary pair + the four messages of the last turn
      expect(messages).toHaveLength(6)
      expect(JSON.stringify(messages[0])).toContain("a.ts: did a")
      expect(messages[2]).toMatchObject({ role: "user", content: "two" })
      // The kept turn's tool call still has its result, which is what providers require.
      expect(JSON.stringify(messages.slice(2))).toContain("tool-result")
    }
  })

  test("the cut never orphans a tool call", () => {
    const session = createSession(cwd)
    appendMessages(session, [...turn("one", "a.ts", "did a"), ...turn("two", "b.ts", "did b")])
    appendCompact(session, "summary")

    const parts = loadSession(session.id).messages.flatMap((message): { type: string; toolCallId?: string }[] =>
      typeof message.content === "string" ? [] : message.content,
    )
    const ids = (kind: string) => parts.filter((part) => part.type === kind).map((part) => part.toolCallId)

    expect(ids("tool-call")).toEqual(ids("tool-result"))
  })

  test("stacked compactions each replace whatever preceded them", () => {
    const session = createSession(cwd)
    appendMessages(session, [...turn("one", "a.ts", "did a"), ...turn("two", "b.ts", "did b")])
    appendCompact(session, "first summary")
    appendMessages(session, turn("three", "c.ts", "did c"))
    appendCompact(session, "second summary")

    const loaded = loadSession(session.id)
    const text = JSON.stringify(loaded.messages)
    expect(text).toContain("second summary")
    expect(text).not.toContain("first summary")
    expect(loaded.messages[2]).toMatchObject({ role: "user", content: "three" })
  })

  test("the full history stays on disk for export", () => {
    const session = createSession(cwd)
    appendMessages(session, [...turn("one", "a.ts", "did a"), ...turn("two", "b.ts", "did b")])
    appendCompact(session, "summary")
    // The dropped messages are still in the file, just not in the loaded view.
    expect(JSON.stringify(loadSession(session.id).messages)).not.toContain("did a")
  })
})

describe("render", () => {
  test("keeps tool names and arguments, since that is where changed files live", () => {
    const text = render(turn("fix it", "src/app.ts", "done"))
    expect(text).toContain("user: fix it")
    expect(text).toContain("tool edit(")
    expect(text).toContain("src/app.ts")
    expect(text).toContain("assistant: done")
  })

  test("clips long values so one huge tool result cannot dominate", () => {
    const text = render([{ role: "user", content: "x".repeat(5000) }])
    expect(text.length).toBeLessThan(1000)
    expect(text).toContain("…")
  })
})

describe("compactSession", () => {
  const config = ConfigSchema.parse({
    model: "mock/big",
    smallModel: "mock/small",
    provider: {
      mock: { npm: join(import.meta.dir, "fixtures", "mock-provider.ts"), export: "createMock", models: {} },
    },
  })

  test("summarizes with the small model and rewrites the session", async () => {
    const session = createSession(cwd)
    appendMessages(session, [...turn("one", "a.ts", "did a"), ...turn("two", "b.ts", "did b")])
    globalThis.mockCalls = []
    globalThis.mockText = "## Files changed\na.ts: renamed the thing"

    const { summary, dropped } = await compactSession(config, session)
    expect(dropped).toBe(4)
    expect(summary).toContain("renamed the thing")
    expect(loadSession(session.id).messages).toHaveLength(6)

    // The cheap model does this work, and it sees the tool calls it needs to describe.
    const call = globalThis.mockCalls[0] as { prompt?: unknown }
    expect(JSON.stringify(call)).toContain("a.ts")
  })

  test("refuses when there is only one turn to work with", async () => {
    const session = createSession(cwd)
    appendMessages(session, turn("one", "a.ts", "did a"))
    expect(compactSession(config, session)).rejects.toThrow(NothingToCompact)
  })

  test("an empty summary leaves the history alone rather than destroying it", async () => {
    const session = createSession(cwd)
    appendMessages(session, [...turn("one", "a.ts", "did a"), ...turn("two", "b.ts", "did b")])
    globalThis.mockText = "   "
    expect(compactSession(config, session)).rejects.toThrow(/returned nothing/)
    expect(loadSession(session.id).messages).toHaveLength(8)
    globalThis.mockText = "summary"
  })
})

describe("attach", () => {
  const workspace = () => mkdtempSync(join(tmpdir(), "jarvis-attach-"))
  const png = Buffer.from("89504e470d0a1a0a", "hex")

  test("a prompt with no mentions stays a plain string", () => {
    expect(attach("just some text", workspace()).content).toBe("just some text")
  })

  test("mentioning an image attaches it as base64 the model can see", () => {
    const cwd = workspace()
    writeFileSync(join(cwd, "shot.png"), png)
    const { content, notes } = attach("what is wrong in @shot.png ?", cwd)

    expect(Array.isArray(content)).toBe(true)
    const parts = content as { type: string; mediaType?: string; data?: string }[]
    expect(parts[0]).toMatchObject({ type: "text" })
    expect(parts[1]).toMatchObject({ type: "file", mediaType: "image/png", data: png.toString("base64") })
    expect(notes).toEqual(["attached shot.png"])
  })

  test("text files are left for the read tool", () => {
    const cwd = workspace()
    writeFileSync(join(cwd, "a.ts"), "code\n")
    expect(attach("look at @a.ts", cwd).content).toBe("look at @a.ts")
  })

  test("the same image mentioned twice is attached once", () => {
    const cwd = workspace()
    writeFileSync(join(cwd, "a.png"), png)
    const { content } = attach("@a.png and again @a.png", cwd)
    expect(content).toHaveLength(2)
  })

  test("refuses to reach outside the workspace", () => {
    const cwd = workspace()
    const { content, notes } = attach("see @../secret.png", cwd)
    expect(content).toBe("see @../secret.png")
    expect(notes[0]).toContain("outside the workspace")
  })

  test("a missing file is silently not attached", () => {
    expect(attach("@nope.png", workspace()).notes).toEqual([])
  })
})

describe("isOverflow", () => {
  test("recognizes the ways providers say the history is too long", () => {
    for (const message of [
      "input length and max tokens exceed context limit",
      "This model's maximum context length is 200000 tokens",
      "prompt is too long: 210000 tokens > 200000 maximum",
      "Please reduce the length of the messages",
    ]) {
      expect(isOverflow(new Error(message))).toBe(true)
    }
  })

  test("does not mistake ordinary failures for overflow", () => {
    for (const message of ["429 rate limit exceeded", "connection reset", "invalid api key"]) {
      expect(isOverflow(new Error(message))).toBe(false)
    }
  })
})
