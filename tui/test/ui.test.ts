import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expand, loadCommands, parseCommandLine, type Command } from "../src/extend/command.ts"
import { describe as describeChord, loadKeymap, matches, parseChord } from "../src/config/keybinds.ts"
import { loadTheme, THEMES } from "../src/config/theme.ts"
import type { Session } from "../src/agent/session.ts"
import { segments } from "../src/ui/components/status.tsx"
import { lerpHex, resolveMotion } from "../src/ui/motion.ts"
import { suggest } from "../src/ui/suggest.ts"
import { applyEvent, summarize, type Item } from "../src/ui/transcript.ts"
import { restore } from "../src/ui/use-turn.ts"

describe("applyEvent", () => {
  test("text deltas coalesce into one assistant block", () => {
    let items: Item[] = []
    items = applyEvent(items, { type: "text", text: "he" })
    items = applyEvent(items, { type: "text", text: "llo" })
    expect(items).toEqual([{ kind: "assistant", text: "hello", agent: undefined }])
  })

  test("a tool result lands on the card its call created", () => {
    let items: Item[] = []
    items = applyEvent(items, { type: "tool-start", id: "c1", name: "read", input: { filePath: "a.ts" } })
    items = applyEvent(items, { type: "tool-end", id: "c1", name: "read", output: "contents", failed: false })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: "tool", id: "c1", output: "contents", failed: false })
  })

  test("text after a tool call starts a new block rather than reopening the old one", () => {
    let items: Item[] = []
    items = applyEvent(items, { type: "text", text: "checking" })
    items = applyEvent(items, { type: "tool-start", id: "c1", name: "read", input: {} })
    items = applyEvent(items, { type: "text", text: "done" })
    expect(items.map((item) => item.kind)).toEqual(["assistant", "tool", "assistant"])
  })

  test("subagent events are tagged so the UI can indent them", () => {
    const items = applyEvent([], { type: "sub", agent: "plan", event: { type: "text", text: "hi" } })
    expect(items[0]).toEqual({ kind: "assistant", text: "hi", agent: "plan" })
  })

  test("errors become notes and usage events change nothing", () => {
    expect(applyEvent([], { type: "error", message: "boom" })).toEqual([
      { kind: "note", text: "boom", level: "error" },
    ])
    expect(applyEvent([], { type: "usage", usage: { input: 1, output: 1, cost: 0 } })).toEqual([])
  })

  test("reasoning deltas coalesce and stay separate from the answer", () => {
    let items: Item[] = []
    items = applyEvent(items, { type: "reasoning", text: "let me " })
    items = applyEvent(items, { type: "reasoning", text: "think" })
    items = applyEvent(items, { type: "text", text: "done" })
    expect(items).toEqual([
      { kind: "reasoning", text: "let me think", agent: undefined },
      { kind: "assistant", text: "done", agent: undefined },
    ])
  })

  test("a tool call is timed from start to result", () => {
    let items: Item[] = []
    items = applyEvent(items, { type: "tool-start", id: "c1", name: "read", input: {} }, undefined, 1000)
    items = applyEvent(items, { type: "tool-end", id: "c1", name: "read", output: "ok", failed: false }, undefined, 1400)
    expect(items[0]).toMatchObject({ startedAt: 1000, endedAt: 1400 })
  })
})

describe("restore", () => {
  const session = (messages: Session["messages"]): Session => ({
    id: "s1",
    cwd: "/tmp",
    created: 0,
    title: "t",
    messages,
  })

  test("keeps both sides of the conversation", () => {
    const items = restore(session([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]))
    expect(items).toEqual([
      { kind: "user", text: "hi" },
      { kind: "assistant", text: "hello" },
    ])
  })

  test("extracts text parts and counts tool calls instead of dropping them", () => {
    const items = restore(session([
      {
        role: "assistant",
        content: [
          { type: "text", text: "reading" },
          { type: "tool-call", toolCallId: "c1", toolName: "read", input: {} },
        ],
      },
    ]))
    expect(items).toEqual([
      { kind: "assistant", text: "reading" },
      { kind: "note", text: "  ✓ 1 tool call", level: "info" },
    ])
  })

  test("tool result messages are not rendered as their own turn", () => {
    const items = restore(session([
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "read", output: { type: "text", value: "x" } }] },
    ]))
    expect(items).toEqual([])
  })
})

describe("suggest", () => {
  const commands: Command[] = [
    { name: "review", description: "Review a file", kind: "builtin" },
    { name: "help", description: "Show help", kind: "builtin" },
  ]
  const files = ["src/ui/app.tsx", "src/agent/agent.ts", "readme.md"]

  test("a slash at the start of the buffer offers commands, prefix matches first", () => {
    const result = suggest("/re", commands, files)
    expect(result).toMatchObject({ kind: "command", token: "/re" })
    expect(result?.choices[0]).toMatchObject({ value: "review", label: "/review" })
  })

  test("an at-sign anywhere offers files and reports only that token", () => {
    const result = suggest("look at @src/ui/a", commands, files)
    expect(result).toMatchObject({ kind: "file", token: "@src/ui/a" })
    expect(result?.choices.map((choice) => choice.value)).toEqual(["src/ui/app.tsx"])
  })

  test("prose and a completed command suggest nothing", () => {
    expect(suggest("just a question", commands, files)).toBeUndefined()
    expect(suggest("/review src/a.ts", commands, files)).toBeUndefined()
    expect(suggest("email me@example.com ok", commands, files)).toBeUndefined()
  })
})

describe("motion", () => {
  test("the environment beats config and a pipe forces everything off", () => {
    expect(resolveMotion("full", { JARVIS_MOTION: "off" }, true)).toBe("off")
    expect(resolveMotion("off", { JARVIS_MOTION: "full" }, true)).toBe("full")
    expect(resolveMotion("full", {}, false)).toBe("off")
    expect(resolveMotion("full", { TERM: "dumb" }, true)).toBe("off")
    expect(resolveMotion("reduced", {}, true)).toBe("reduced")
  })

  test("lerpHex hits both endpoints exactly and rejects what it cannot parse", () => {
    expect(lerpHex("#000000", "#ffffff", 0)).toBe("#000000")
    expect(lerpHex("#000000", "#ffffff", 1)).toBe("#ffffff")
    expect(lerpHex("#102030", "#102030", 0.4)).toBe("#102030")
    expect(lerpHex("#000000", "#ffffff", 0.5)).toBe("#808080")
    expect(lerpHex("red", "#ffffff", 0.5)).toBe("#ffffff")
  })
})

describe("status segments", () => {
  const usage = { input: 30_000, output: 12_000, cost: 0.42 }

  test("a wide terminal shows everything, with context as a percentage", () => {
    const { left, right } = segments({
      model: "anthropic/claude-opus-4-5",
      cwd: "/home/me/project",
      branch: "main",
      usage,
      contextLimit: 200_000,
      width: 200,
    })
    expect(left).toBe("anthropic/claude-opus-4-5")
    expect(right).toBe("$0.4200  main  project  42.0k/200.0k 21%")
  })

  test("a narrow terminal drops extras but never the token count", () => {
    const narrow = segments({
      model: "anthropic/claude-opus-4-5",
      cwd: "/home/me/project",
      branch: "main",
      usage,
      contextLimit: 200_000,
      width: 70,
    })
    expect(narrow.right).toBe("42.0k/200.0k 21%")
  })

  test("without a declared context limit it falls back to a raw token count", () => {
    const { right } = segments({ model: "m", cwd: "/tmp/x", usage, width: 200 })
    expect(right).toContain("42.0k tokens")
  })
})

describe("summarize", () => {
  test("picks the most descriptive field and clips it to one line", () => {
    expect(summarize("read", { filePath: "src/a.ts" })).toBe("read src/a.ts")
    expect(summarize("bash", { command: "ls\nrm" })).toBe("bash ls")
    expect(summarize("glob", {})).toBe("glob")
  })
})

describe("commands", () => {
  test("parses a slash line into name and arguments", () => {
    expect(parseCommandLine("/review src/a.ts and b")).toEqual({ name: "review", args: "src/a.ts and b" })
    expect(parseCommandLine("/help")).toEqual({ name: "help", args: "" })
    expect(parseCommandLine("not a command")).toBeUndefined()
  })

  test("markdown commands are discovered and $ARGUMENTS substituted", () => {
    const cwd = mkdtempSync(join(tmpdir(), "jarvis-cmd-"))
    mkdirSync(join(cwd, ".jarvis", "command"), { recursive: true })
    writeFileSync(
      join(cwd, ".jarvis", "command", "review.md"),
      "---\ndescription: Review a file\nagent: plan\n---\nReview $ARGUMENTS carefully.\n",
    )
    const command = loadCommands(cwd).find((entry) => entry.name === "review")
    expect(command).toMatchObject({ kind: "prompt", description: "Review a file", agent: "plan" })
    expect(expand(command as never, "src/a.ts")).toBe("Review src/a.ts carefully.")
  })

  test("a template without $ARGUMENTS gets them appended", () => {
    expect(expand({ name: "x", description: "", kind: "prompt", template: "Do it." }, "now")).toBe("Do it.\n\nnow")
  })
})

describe("keybinds", () => {
  test("parses modifiers and round-trips through describe", () => {
    expect(parseChord("ctrl+shift+return")).toEqual({ name: "return", ctrl: true, shift: true, meta: false })
    expect(describeChord(parseChord("ctrl+return"))).toBe("ctrl+enter")
  })

  test("config overrides replace defaults, matching is exact on modifiers", () => {
    const keymap = loadKeymap({ interrupt: "ctrl+g" })
    expect(matches({ name: "g", ctrl: true }, keymap.interrupt)).toBe(true)
    expect(matches({ name: "g" }, keymap.interrupt)).toBe(false)
    expect(keymap.submit.name).toBe("return")
  })
})

describe("themes", () => {
  test("built-ins resolve by name and unknown names fall back", () => {
    expect(loadTheme("light")).toEqual(THEMES.light!)
    expect(loadTheme("does-not-exist")).toEqual(THEMES.jarvis!)
  })
})
