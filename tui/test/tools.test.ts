import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { constantAsker, PermissionGate, resolvePermission } from "../src/permission.ts"
import { builtinTools, filterTools, resolvePath, ToolError, type ToolContext } from "../src/tools/index.ts"

function setup(allow = true) {
  const cwd = mkdtempSync(join(tmpdir(), "jarvis-tools-"))
  const ctx: ToolContext = {
    cwd,
    worktree: cwd,
    gate: new PermissionGate({}, constantAsker(allow)),
    read: new Set<string>(),
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

  test("a rejected prompt leaves the file untouched", async () => {
    const { cwd, tools } = setup(false)
    expect(call(tools.write, { filePath: "a.ts", content: "x" })).rejects.toThrow(/permission denied/)
    expect(await Bun.file(join(cwd, "a.ts")).exists()).toBe(false)
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
