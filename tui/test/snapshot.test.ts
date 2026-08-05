import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { constantAsker, PermissionGate } from "../src/permission.ts"
import { builtinTools, type ToolContext } from "../src/tools/index.ts"
import { beginGroup, clearSnapshots, endGroup, redo, undo } from "../src/tools/snapshot.ts"

let sessions = 0

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "jarvis-snapshot-"))
  const sessionID = `s${++sessions}`
  const ctx: ToolContext = {
    cwd,
    worktree: cwd,
    blueprints: join(cwd, "blueprints"),
    gate: new PermissionGate({}, constantAsker(true)),
    read: new Map<string, number>(),
    depth: 0,
    agent: "build",
    sessionID,
  }
  return { cwd, sessionID, tools: builtinTools(ctx), ctx }
}

const call = async (tool: unknown, input: unknown) =>
  (await (tool as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(input, {})) as string

describe("undo", () => {
  test("reverts every file one turn wrote, as one step", async () => {
    const { cwd, sessionID, tools } = setup()
    writeFileSync(join(cwd, "existing.ts"), "original\n")

    beginGroup(sessionID)
    await call(tools.write, { filePath: "existing.ts", content: "changed\n" })
    await call(tools.write, { filePath: "brand-new.ts", content: "new\n" })
    endGroup(sessionID)

    const result = undo(sessionID)
    expect("files" in result && result.files).toHaveLength(2)
    // Modified file goes back to its old content...
    expect(readFileSync(join(cwd, "existing.ts"), "utf8")).toBe("original\n")
    // ...and a file that did not exist before is removed again.
    expect(existsSync(join(cwd, "brand-new.ts"))).toBe(false)
    clearSnapshots(sessionID)
  })

  test("keeps the content from before the turn, not before the last write", async () => {
    const { cwd, sessionID, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "v1\n")

    beginGroup(sessionID)
    await call(tools.write, { filePath: "a.ts", content: "v2\n" })
    await call(tools.write, { filePath: "a.ts", content: "v3\n" })
    endGroup(sessionID)

    undo(sessionID)
    expect(readFileSync(join(cwd, "a.ts"), "utf8")).toBe("v1\n")
    clearSnapshots(sessionID)
  })

  test("each turn is its own step", async () => {
    const { cwd, sessionID, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "v1\n")

    beginGroup(sessionID)
    await call(tools.write, { filePath: "a.ts", content: "v2\n" })
    endGroup(sessionID)
    beginGroup(sessionID)
    await call(tools.write, { filePath: "a.ts", content: "v3\n" })
    endGroup(sessionID)

    undo(sessionID)
    expect(readFileSync(join(cwd, "a.ts"), "utf8")).toBe("v2\n")
    undo(sessionID)
    expect(readFileSync(join(cwd, "a.ts"), "utf8")).toBe("v1\n")
    clearSnapshots(sessionID)
  })

  test("redo puts the change back, and a new turn drops the redo history", async () => {
    const { cwd, sessionID, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "v1\n")

    beginGroup(sessionID)
    await call(tools.write, { filePath: "a.ts", content: "v2\n" })
    endGroup(sessionID)

    undo(sessionID)
    expect(readFileSync(join(cwd, "a.ts"), "utf8")).toBe("v1\n")
    redo(sessionID)
    expect(readFileSync(join(cwd, "a.ts"), "utf8")).toBe("v2\n")

    undo(sessionID)
    beginGroup(sessionID)
    expect(redo(sessionID)).toMatchObject({ error: "nothing to redo" })
    clearSnapshots(sessionID)
  })

  test("a turn that wrote nothing is not an undo step", async () => {
    const { sessionID } = setup()
    beginGroup(sessionID)
    endGroup(sessionID)
    expect(undo(sessionID)).toMatchObject({ error: "nothing to undo" })
    clearSnapshots(sessionID)
  })

  test("edits are snapshotted too", async () => {
    const { cwd, sessionID, tools } = setup()
    writeFileSync(join(cwd, "a.ts"), "keep me\n")

    beginGroup(sessionID)
    await call(tools.read, { filePath: "a.ts" })
    await call(tools.edit, { filePath: "a.ts", oldString: "keep", newString: "lose" })
    endGroup(sessionID)

    undo(sessionID)
    expect(readFileSync(join(cwd, "a.ts"), "utf8")).toBe("keep me\n")
    clearSnapshots(sessionID)
  })
})

describe("background bash", () => {
  test("returns immediately and the output can be read afterwards", async () => {
    const { tools } = setup()
    const started = await call(tools.bash, { command: "echo working; sleep 0.2; echo finished", background: true })
    expect(started).toContain("bg")

    const id = /bg\d+/.exec(started)![0]
    // Long enough for the command to finish writing.
    await Bun.sleep(500)
    const output = await call(tools.bash_output, { id })
    expect(output).toContain("working")
    expect(output).toContain("finished")
    expect(output).toContain("exited 0")
  })

  test("a command that outlives the call reports as running, and kill stops it", async () => {
    const { tools } = setup()
    const started = await call(tools.bash, { command: "sleep 30", background: true })
    const id = /bg\d+/.exec(started)![0]

    expect(await call(tools.bash_output, { id })).toContain("running")
    expect(await call(tools.bash_output, { id, kill: true })).toBeTruthy()
    await Bun.sleep(100)
    expect(await call(tools.bash_output, { id })).not.toContain("(running)")
  })

  test("an unknown id is an error, not silence", async () => {
    const { tools } = setup()
    expect(call(tools.bash_output, { id: "bg999" })).rejects.toThrow(/no background command/)
  })
})
