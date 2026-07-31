import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expand, loadCommands, parseCommandLine, type Command } from "../src/extend/command.ts"
import { describe as describeChord, loadKeymap, matches, parseChord } from "../src/config/keybinds.ts"
import { loadTheme, THEMES } from "../src/config/theme.ts"
import type { Session } from "../src/agent/session.ts"
import { segments, type Part } from "../src/ui/components/status.tsx"
import { parseGit } from "../src/ui/git.ts"
import { lerpHex, resolveMotion } from "../src/ui/motion.ts"
import { completion, suggest } from "../src/ui/suggest.ts"
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

  test("commands complete to the slash form, files drop the trigger", () => {
    expect(completion(suggest("/re", commands, files)!, 0)).toBe("/review")
    expect(completion(suggest("@src/ui/a", commands, files)!, 0)).toBe("src/ui/app.tsx")
    expect(completion(suggest("/re", commands, files)!, 9)).toBeUndefined()
  })

  test("a fully typed command completes to itself, which is how enter still sends it", () => {
    // The submit handler compares the completion against the token: equal means the user
    // typed the whole thing and enter should send, not re-complete.
    const result = suggest("/help", commands, files)!
    expect(completion(result, 0)).toBe(result.token)
    // One more character to match and enter completes instead.
    const partial = suggest("/hel", commands, files)!
    expect(completion(partial, 0)).not.toBe(partial.token)
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

describe("parseGit", () => {
  test("a clean tree on a tracked branch", () => {
    expect(parseGit("## main...origin/main\n")).toEqual({ branch: "main", dirty: false })
  })

  test("ahead/behind counts do not leak into the branch name", () => {
    expect(parseGit("## main...origin/main [ahead 1, behind 2]\n")).toEqual({ branch: "main", dirty: false })
  })

  test("an untracked branch has no upstream to split on", () => {
    expect(parseGit("## refactor/full-rewrite\n")).toEqual({ branch: "refactor/full-rewrite", dirty: false })
  })

  test("any changed file makes the tree dirty", () => {
    expect(parseGit("## main...origin/main\n M src/a.ts\n?? b.ts\n")).toEqual({ branch: "main", dirty: true })
  })

  test("a detached head names no branch", () => {
    expect(parseGit("## HEAD (no branch)\n M src/a.ts\n")).toEqual({ branch: undefined, dirty: true })
  })

  test("no output at all is not a repo", () => {
    expect(parseGit("")).toEqual({ branch: undefined, dirty: false })
  })
})

describe("status segments", () => {
  const usage = { input: 30_000, output: 12_000, cost: 0.42 }
  const flat = (parts: Part[]) => parts.map((part) => part.text).join("")

  test("a wide terminal shows everything, with context as a percentage", () => {
    const { left, right } = segments({
      model: "anthropic/claude-opus-4-5",
      cwd: "/home/me/project",
      git: { branch: "main", dirty: false },
      usage,
      contextLimit: 200_000,
      contextTokens: 42_000,
      width: 200,
    })
    expect(left).toBe("anthropic/claude-opus-4-5")
    expect(flat(right)).toBe("$0.4200  project ⑂ main  42.0k/200.0k 21%")
  })

  test("the branch is colored apart from the directory it sits next to", () => {
    const { right } = segments({
      model: "m",
      cwd: "/home/me/project",
      git: { branch: "main", dirty: true },
      usage,
      width: 200,
    })
    expect(flat(right)).toContain("project ⑂ main*")
    expect(right.find((part) => part.text === "main")?.tone).toBe("accent")
    expect(right.find((part) => part.text === "*")?.tone).toBe("warning")
  })

  test("outside a repo the location is just the directory", () => {
    const { right } = segments({ model: "m", cwd: "/home/me/project", usage, width: 200 })
    expect(flat(right)).toContain("$0.4200  project  ")
    expect(flat(right)).not.toContain("⑂")
  })

  test("the percentage tracks window occupancy, not the session total", () => {
    // A multi-step turn re-sends the history each step, so usage.input sums far past the
    // window. Only the last step's prompt says how full the window really got.
    const { right } = segments({
      model: "m",
      cwd: "/p",
      usage: { input: 900_000, output: 20_000, cost: 0 },
      contextLimit: 200_000,
      contextTokens: 60_000,
      width: 200,
    })
    expect(flat(right)).toContain("60.0k/200.0k 30%")
  })

  test("without a measured prompt size it falls back to the session token count", () => {
    const { right } = segments({ model: "m", cwd: "/p", usage, contextLimit: 200_000, width: 200 })
    expect(flat(right)).toContain("42.0k tokens")
  })

  test("a narrow terminal drops extras but never the token count", () => {
    const narrow = segments({
      model: "anthropic/claude-opus-4-5",
      cwd: "/home/me/project",
      git: { branch: "main", dirty: false },
      usage,
      contextLimit: 200_000,
      contextTokens: 42_000,
      width: 70,
    })
    expect(flat(narrow.right)).toBe("42.0k/200.0k 21%")
  })

  test("a branch never survives without the directory that locates it", () => {
    // The location is one droppable group, so no width can leave a bare branch name behind.
    for (let width = 0; width < 200; width++) {
      const { right } = segments({
        model: "m",
        cwd: "/home/me/project",
        git: { branch: "very-long-branch-name", dirty: true },
        usage,
        contextLimit: 200_000,
        contextTokens: 42_000,
        width,
      })
      const text = flat(right)
      expect(text.includes("very-long-branch-name")).toBe(text.includes("project"))
    }
  })

  test("without a declared context limit it falls back to a raw token count", () => {
    const { right } = segments({ model: "m", cwd: "/tmp/x", usage, width: 200 })
    expect(flat(right)).toContain("42.0k tokens")
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
