import { afterAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { ConfigSchema, type Permission } from "../src/config/config.ts"
import { startMcp, toolName } from "../src/extend/mcp.ts"
import { constantAsker, PermissionGate } from "../src/permission.ts"
import { gateTools, type ToolSet } from "../src/tools/index.ts"

const config = ConfigSchema.parse({
  mcp: {
    fixture: { type: "local", command: ["bun", join(import.meta.dir, "fixtures", "mcp-server.ts")] },
    broken: { type: "local", command: ["definitely-not-a-real-binary"] },
    off: { type: "local", command: ["bun", "--version"], enabled: false },
  },
})

const session = await startMcp(config)
afterAll(() => session.close())

const call = async (name: string, input: unknown) =>
  await (session.tools[name] as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(input, {})

describe("startMcp", () => {
  test("namespaces tools by server and skips disabled ones", () => {
    expect(Object.keys(session.tools).sort()).toEqual([toolName("fixture", "explode"), toolName("fixture", "shout")])
  })

  test("a server that fails to start is reported, not thrown", () => {
    expect(session.status.find((s) => s.server === "broken")?.error).toBeTruthy()
    expect(session.status.find((s) => s.server === "fixture")).toMatchObject({ tools: 2 })
    expect(session.status.map((s) => s.server)).not.toContain("off")
  })

  test("calls a tool and flattens the content blocks", async () => {
    expect(await call(toolName("fixture", "shout"), { text: "hello" })).toBe("HELLO")
  })

  test("an isError result becomes a thrown tool error", async () => {
    expect(call(toolName("fixture", "explode"), {})).rejects.toThrow("boom")
  })
})

describe("gateTools", () => {
  const shout = toolName("fixture", "shout")
  const gated = (rules: Record<string, Permission>, allow: boolean) =>
    gateTools(session.tools, new PermissionGate(rules, constantAsker(allow)), new Set())

  const run = async (tools: ToolSet, name: string) =>
    await (tools[name] as { execute: (i: unknown, o: unknown) => Promise<string> }).execute({ text: "hi" }, {})

  test("MCP tools ask by default and a rejection stops the call", async () => {
    expect(run(gated({}, false), shout)).rejects.toThrow(/permission denied for mcp/)
    expect(await run(gated({}, true), shout)).toBe("HI")
  })

  test("prefix rules address individual MCP tools", async () => {
    // Matched by subject, which is the name minus the `mcp_` namespace.
    expect(run(gated({ "mcp:fixture_shout": "deny" }, true), shout)).rejects.toThrow(/permission denied/)
    // A deny on a sibling tool leaves this one alone; the asker is never consulted.
    expect(await run(gated({ "mcp:fixture_explode": "deny", "mcp:fixture_shout": "allow" }, false), shout)).toBe("HI")
  })

  test("exempt tools are left untouched", async () => {
    const exempt = gateTools(session.tools, new PermissionGate({}, constantAsker(false)), new Set([shout]))
    expect(await run(exempt, shout)).toBe("HI")
  })
})
