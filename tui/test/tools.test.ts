import { describe, expect, test } from "bun:test"
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { constantAsker, PermissionGate, resolvePermission } from "../src/permission.ts"
import { builtinTools, filterTools, resolvePath, ToolError, type ToolContext } from "../src/tools/index.ts"
import { textFromHtml } from "../src/tools/webfetch.ts"

function setup(allow = true) {
  const cwd = mkdtempSync(join(tmpdir(), "jarvis-tools-"))
  const ctx: ToolContext = {
    cwd,
    worktree: cwd,
    blueprints: join(cwd, "blueprints"),
    gate: new PermissionGate({}, constantAsker(allow)),
    read: new Map<string, number>(),
    depth: 0,
    agent: "build",
    sessionID: "test",
  }
  return { cwd, ctx, tools: builtinTools(ctx) }
}

/** Tool.execute is optional in the AI SDK types; every built-in defines it. */
const call = async (tool: unknown, input: unknown) =>
  (await (tool as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(input, {})) as string

describe("resolvePath", () => {
  test("refuses paths that escape the workspace", () => {
    const { ctx } = setup()
    expect(() => resolvePath(ctx, "../../etc/passwd")).toThrow(ToolError)
    expect(() => resolvePath(ctx, "/etc/passwd")).toThrow(ToolError)
    expect(resolvePath(ctx, "a/b.ts")).toBe(join(ctx.cwd, "a/b.ts"))
  })
})

describe("blueprint_edit", () => {
  // The failure this replaces: a model called blueprint_edit with `simple_electrical`, was
  // refused for the underscore, retried with a valid name, and got "no blueprint named …"
  // because it never worked out it had to call `blueprint` action:"create" first. One call
  // has to be enough, and the name it sends has to be the name it gets.
  test("one call draws, with no create call and a name a model would really send", async () => {
    const { ctx, tools } = setup()
    const out = await call(tools.blueprint_edit, {
      name: "simple_electrical",
      ops: [
        { op: "add", entity: { type: "circle", c: [20, 20], r: 6 } },
        { op: "add", entity: { type: "line", a: [0, 20], b: [14, 20] } },
      ],
    })
    expect(out).toContain("simple-electrical")
    expect(out).toContain("2 entities")
    const listed = await call(tools.blueprint, { action: "list" })
    expect(listed).toContain("simple-electrical")
    // Committed, not just written: the store is a git repo and history is the point of it.
    expect(await call(tools.blueprint, { action: "history", name: "simple_electrical" })).toContain("add circle")
  })

  test("a second call edits the same blueprint rather than starting a new one", async () => {
    const { tools } = setup()
    await call(tools.blueprint_edit, { name: "plate", ops: [{ op: "add", entity: { type: "circle", c: [0, 0], r: 5 } }] })
    const out = await call(tools.blueprint_edit, {
      name: "plate",
      ops: [{ op: "add", entity: { type: "circle", c: [10, 0], r: 5 } }],
    })
    expect(out).toContain("2 entities")
  })

  test("an entity that is invalid for its type is still refused", async () => {
    const { tools } = setup()
    // The flat payload is looser on the wire, not in what reaches disk.
    expect(call(tools.blueprint_edit, { name: "plate", ops: [{ op: "add", entity: { type: "circle", c: [0, 0] } }] }))
      .rejects.toThrow(/circle/)
    expect(await call(tools.blueprint, { action: "list" })).toContain("no blueprints yet")
  })
})

describe("blueprint_symbol", () => {
  test("places on a blueprint that does not exist yet", async () => {
    const { tools } = setup()
    const out = await call(tools.blueprint_symbol, { action: "place", name: "circuit", symbol: "resistor", at: [10, 10] })
    expect(out).toContain("circuit")
    expect(await call(tools.blueprint, { action: "list" })).toContain("circuit")
  })

  test("the reply names the ports to connect by, not their coordinates", async () => {
    const { tools } = setup()
    const out = await call(tools.blueprint_symbol, {
      action: "place",
      name: "circuit",
      placements: [{ symbol: "electrical/resistor", at: [10, 10], label: "R1" }],
    })
    expect(out).toContain("connect with R1.1..R1.2")
  })
})

describe("connect end to end", () => {
  // The whole point of the feature: two named ports in, a wire on disk, and at no stage
  // does the caller work out where the wire goes.
  test("a wire runs between the two ports the caller named", async () => {
    const { tools } = setup()
    await call(tools.blueprint_symbol, {
      action: "place",
      name: "circuit",
      placements: [
        { symbol: "electrical/resistor", at: [20, 20], label: "R1" },
        { symbol: "electrical/lamp", at: [80, 60], label: "L1" },
      ],
    })
    const out = await call(tools.blueprint_edit, {
      name: "circuit",
      ops: [{ op: "connect", from: "R1.2", to: "L1.1" }],
    })
    expect(out).toContain("connect")
    const json = await call(tools.blueprint_view, { name: "circuit", format: "json" })
    const doc = JSON.parse(json.slice(json.indexOf("{"))) as {
      entities: { id: string; type: string; pts?: [number, number][] }[]
      parts: { ref: string; ports: [number, number][] }[]
    }
    const wire = doc.entities.find((entity) => entity.id === "w1")
    const r1 = doc.parts.find((part) => part.ref === "R1")!
    const l1 = doc.parts.find((part) => part.ref === "L1")!
    expect(wire?.pts?.[0]).toEqual(r1.ports[1]!)
    expect(wire?.pts?.at(-1)).toEqual(l1.ports[0]!)
  })

  test("wiring a port that does not exist says which ones do", async () => {
    const { tools } = setup()
    await call(tools.blueprint_symbol, {
      action: "place",
      name: "circuit",
      placements: [{ symbol: "electrical/resistor", at: [20, 20], label: "R1" }],
    })
    expect(call(tools.blueprint_edit, { name: "circuit", ops: [{ op: "connect", from: "R1.1", to: "Q7.1" }] }))
      .rejects.toThrow(/R1/)
  })
})

describe("ask", () => {
  test("is absent when there is nobody to answer", () => {
    const { tools } = setup()
    expect(tools.ask).toBeUndefined()
  })

  test("returns what the user picked", async () => {
    const { ctx } = setup()
    const tools = builtinTools({ ...ctx, ask: async (_question, options) => options[1]! })
    expect(await call(tools.ask, { question: "which units?", options: ["mm", "in"] })).toBe("in")
  })

  test("a dismissed question tells the model to assume rather than re-ask", async () => {
    const { ctx } = setup()
    const tools = builtinTools({ ...ctx, ask: async () => "" })
    expect(call(tools.ask, { question: "which units?", options: ["mm", "in"] })).rejects.toThrow(ToolError)
  })
})

describe("edit", () => {
  test("requires the file to have been read first", async () => {
    const { cwd, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "const x = 1\n")
    const input = { filePath: "a.ts", oldString: "1", newString: "2" }
    expect(call(tools.edit, input)).rejects.toThrow(/read a.ts before editing/)

    await call(tools.read, { filePath: "a.ts" })
    await call(tools.edit, input)
    expect(await Bun.file(join(cwd, "a.ts")).text()).toBe("const x = 2\n")
  })

  test("refuses an ambiguous oldString unless replaceAll is set", async () => {
    const { cwd, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "x\nx\n")
    await call(tools.read, { filePath: "a.ts" })
    expect(call(tools.edit, { filePath: "a.ts", oldString: "x", newString: "y" })).rejects.toThrow(/appears 2 times/)
    await call(tools.edit, { filePath: "a.ts", oldString: "x", newString: "y", replaceAll: true })
    expect(await Bun.file(join(cwd, "a.ts")).text()).toBe("y\ny\n")
  })
})

describe("write", () => {
  test("creates parent directories and counts as a read", async () => {
    const { cwd, ctx, tools } = setup()
    await call(tools.write, { filePath: "deep/nested/a.ts", content: "ok\n" })
    expect(await Bun.file(join(cwd, "deep/nested/a.ts")).text()).toBe("ok\n")
    expect(ctx.read.has(join(cwd, "deep/nested/a.ts"))).toBe(true)
  })
})

describe("stale reads", () => {
  test("refuses to edit a file that changed on disk since it was read", async () => {
    const { cwd, tools } = setup()
    const path = join(cwd, "a.ts")
    writeFileSync(path, "const x = 1\n")
    await call(tools.read, { filePath: "a.ts" })

    // Someone edits the file behind the agent's back.
    const later = new Date(Date.now() + 2000)
    writeFileSync(path, "const x = 1\nconst y = 2\n")
    utimesSync(path, later, later)

    expect(call(tools.edit, { filePath: "a.ts", oldString: "1", newString: "3" })).rejects.toThrow(
      /changed on disk/,
    )
    // The outside change survives.
    expect(await Bun.file(path).text()).toContain("const y = 2")
  })

  test("consecutive edits to one file keep working", async () => {
    const { cwd, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "a b\n")
    await call(tools.read, { filePath: "a.ts" })
    await call(tools.edit, { filePath: "a.ts", oldString: "a", newString: "c" })
    await call(tools.edit, { filePath: "a.ts", oldString: "b", newString: "d" })
    expect(await Bun.file(join(cwd, "a.ts")).text()).toBe("c d\n")
  })

  test("a rejected prompt leaves the file untouched", async () => {
    const { cwd, tools } = setup(false)
    expect(call(tools.write, { filePath: "a.ts", content: "x" })).rejects.toThrow(/permission denied/)
    expect(await Bun.file(join(cwd, "a.ts")).exists()).toBe(false)
  })
})

describe("multi-edit", () => {
  test("applies several replacements in order as one approval", async () => {
    const { cwd, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "one two three\n")
    await call(tools.read, { filePath: "a.ts" })
    const output = await call(tools.edit, {
      filePath: "a.ts",
      edits: [
        { oldString: "one", newString: "1" },
        { oldString: "three", newString: "3" },
      ],
    })
    expect(output).toContain("2 changes")
    expect(await Bun.file(join(cwd, "a.ts")).text()).toBe("1 two 3\n")
  })

  test("a later edit can act on what an earlier one produced", async () => {
    const { cwd, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "a\n")
    await call(tools.read, { filePath: "a.ts" })
    await call(tools.edit, {
      filePath: "a.ts",
      edits: [
        { oldString: "a", newString: "b" },
        { oldString: "b", newString: "c" },
      ],
    })
    expect(await Bun.file(join(cwd, "a.ts")).text()).toBe("c\n")
  })

  test("one bad edit in the set leaves the file untouched", async () => {
    const { cwd, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "a b\n")
    await call(tools.read, { filePath: "a.ts" })
    expect(
      call(tools.edit, {
        filePath: "a.ts",
        edits: [
          { oldString: "a", newString: "x" },
          { oldString: "nope", newString: "y" },
        ],
      }),
    ).rejects.toThrow(/not found/)
    expect(await Bun.file(join(cwd, "a.ts")).text()).toBe("a b\n")
  })

  test("still accepts the single inline replacement form", async () => {
    const { cwd, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "old\n")
    await call(tools.read, { filePath: "a.ts" })
    await call(tools.edit, { filePath: "a.ts", oldString: "old", newString: "new" })
    expect(await Bun.file(join(cwd, "a.ts")).text()).toBe("new\n")
  })

  test("rejects a call with neither form", async () => {
    const { cwd, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "x\n")
    await call(tools.read, { filePath: "a.ts" })
    expect(call(tools.edit, { filePath: "a.ts" })).rejects.toThrow(/either oldString/)
  })
})

describe("check", () => {
  test("a failing command comes back with the write, a passing one stays quiet", async () => {
    const { cwd, ctx, tools } = setup()
    ctx.check = { "**/*.ts": ["exit 0"], "**/*.bad": ["echo 'it is broken'; exit 2"] }

    expect(await call(tools.write, { filePath: "a.ts", content: "ok\n" })).not.toContain("<check")

    const failed = await call(tools.write, { filePath: "a.bad", content: "x\n" })
    expect(failed).toContain("created a.bad")
    expect(failed).toContain('exit="2"')
    expect(failed).toContain("it is broken")
    expect(await Bun.file(join(cwd, "a.bad")).exists()).toBe(true)
  })

  test("$FILE is the path that was written", async () => {
    const { ctx, tools } = setup()
    ctx.check = { "**/*.ts": ["echo $FILE; exit 1"] }
    expect(await call(tools.write, { filePath: "deep/a.ts", content: "x\n" })).toContain("deep/a.ts")
  })

  test("a formatter that rewrites the file does not trip the stale-read guard", async () => {
    const { cwd, ctx, tools } = setup()
    ctx.check = { "**/*.ts": ["printf 'formatted\\n' > $FILE"] }
    writeFileSync(join(cwd, "a.ts"), "raw\n")
    await call(tools.read, { filePath: "a.ts" })
    await call(tools.edit, { filePath: "a.ts", oldString: "raw", newString: "edited" })
    expect(await Bun.file(join(cwd, "a.ts")).text()).toBe("formatted\n")
    // The next edit must still be allowed, against the formatter's output.
    await call(tools.edit, { filePath: "a.ts", oldString: "formatted", newString: "again" })
  })

  test("files matching no pattern skip the machinery entirely", async () => {
    const { ctx, tools } = setup()
    ctx.check = { "**/*.py": ["exit 1"] }
    expect(await call(tools.write, { filePath: "a.ts", content: "x" })).not.toContain("<check")
  })
})

describe("todo", () => {
  test("replaces the list and reads it back with progress", async () => {
    const { tools } = setup()
    const written = await call(tools.todo, {
      todos: [
        { text: "first", status: "done" },
        { text: "second", status: "in_progress" },
      ],
    })
    expect(written).toContain("1/2 done")
    expect(written).toContain("☑ first")
    expect(written).toContain("◐ second")
    // No argument is a read.
    expect(await call(tools.todo, {})).toBe(written)
  })

  test("an empty list says so rather than returning nothing", async () => {
    const { tools } = setup()
    expect(await call(tools.todo, { todos: [] })).toBe("the list is empty")
  })
})

describe("webfetch", () => {
  test("strips scripts, tags and entities but keeps the prose", () => {
    const text = textFromHtml(
      "<html><head><style>p{color:red}</style></head><body><script>evil()</script>" +
        "<h1>Title</h1><p>First &amp; second</p><p>Third</p></body></html>",
    )
    expect(text).not.toContain("evil")
    expect(text).not.toContain("color:red")
    expect(text).toContain("Title")
    expect(text).toContain("First & second")
    expect(text).toContain("Third")
  })

  test("refuses anything that is not http(s)", async () => {
    const { tools } = setup()
    expect(call(tools.webfetch, { url: "file:///etc/passwd" })).rejects.toThrow(/only http/)
    expect(call(tools.webfetch, { url: "not a url" })).rejects.toThrow(/not a valid URL/)
  })

  test("a rejected permission stops the request", async () => {
    const { tools } = setup(false)
    expect(call(tools.webfetch, { url: "https://example.com" })).rejects.toThrow(/permission denied/)
  })
})

describe("bash", () => {
  test("reports the exit code and both streams", async () => {
    const { tools } = setup()
    const output = await call(tools.bash, { command: "echo out; echo err >&2; exit 3" })
    expect(output).toContain("exit 3")
    expect(output).toContain("out")
    expect(output).toContain("err")
  })

  test("runs in the workspace root", async () => {
    const { cwd, tools } = setup()
    expect(await call(tools.bash, { command: "pwd" })).toContain(cwd)
  })
})

describe("glob and grep", () => {
  test("find files and matches relative to the workspace", async () => {
    const { cwd, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "needle here\n")
    writeFileSync(join(cwd, "b.md"), "nothing\n")
    expect(await call(tools.glob, { pattern: "*.ts" })).toBe("a.ts")
    expect(await call(tools.grep, { pattern: "needle" })).toContain("a.ts")
    expect(await call(tools.grep, { pattern: "haystack" })).toBe("no matches")
  })
})

describe("resolvePermission", () => {
  const rules = { bash: "ask" as const, "bash:git ": "allow" as const, write: "deny" as const }

  test("the most specific prefix wins", () => {
    expect(resolvePermission(rules, { tool: "bash", title: "", subject: "git status" })).toBe("allow")
    expect(resolvePermission(rules, { tool: "bash", title: "", subject: "rm -rf /" })).toBe("ask")
    expect(resolvePermission(rules, { tool: "write", title: "", subject: "a.ts" })).toBe("deny")
  })

  test("unmatched tools fall through to the default", () => {
    expect(resolvePermission(rules, { tool: "read", title: "" })).toBe("allow")
    expect(resolvePermission({ "*": "deny" }, { tool: "read", title: "" })).toBe("deny")
  })
})

describe("filterTools", () => {
  const tools = { read: {}, write: {}, bash: {}, mcp_a_x: {} } as never

  test("explicit entries win over the default", () => {
    expect(Object.keys(filterTools(tools, { write: false }, true))).toEqual(["read", "bash", "mcp_a_x"])
    expect(Object.keys(filterTools(tools, { read: true }, false))).toEqual(["read"])
  })

  test("a trailing star matches by prefix", () => {
    expect(Object.keys(filterTools(tools, { "mcp_*": false }, true))).toEqual(["read", "write", "bash"])
  })
})
