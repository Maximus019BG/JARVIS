import { afterAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { ConfigSchema } from "../src/config.ts"
import { startMcp, toolName } from "../src/mcp.ts"

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
