import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expand, loadCommands, parseCommandLine } from "../src/extend/command.ts"
import { describe as describeChord, loadKeymap, matches, parseChord } from "../src/config/keybinds.ts"
import { loadTheme, THEMES } from "../src/config/theme.ts"
import { applyEvent, summarize, type Item } from "../src/ui/transcript.ts"

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
