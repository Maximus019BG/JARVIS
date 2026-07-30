import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, type AgentEvent } from "../src/agent/agent.ts"
import { ConfigSchema } from "../src/config/config.ts"
import { constantAsker, PermissionGate } from "../src/permission.ts"
import type { MockPart } from "./fixtures/mock-provider.ts"

const config = ConfigSchema.parse({
  model: "mock/test",
  provider: {
    mock: {
      npm: join(import.meta.dir, "fixtures", "mock-provider.ts"),
      export: "createMock",
      models: { test: { cost: { input: 1, output: 2 } } },
    },
  },
})

function script(...steps: MockPart[][]) {
  globalThis.mockSteps = steps
  globalThis.mockCalls = []
}

const workspace = () => mkdtempSync(join(tmpdir(), "jarvis-agent-"))

/** The tool names the model was actually offered on a given call. */
function toolNames(call: unknown): string[] {
  const tools = (call as { tools?: { name: string }[] }).tools ?? []
  return tools.map((tool) => tool.name)
}

async function turn(prompt: string, cwd: string, allow = true) {
  const events: AgentEvent[] = []
  const result = await run({
    config,
    cwd,
    messages: [{ role: "user", content: prompt }],
    gate: new PermissionGate(config.permission, constantAsker(allow)),
    onEvent: (event) => events.push(event),
  })
  return { result, events }
}

beforeEach(() => script())

describe("run", () => {
  test("streams text and reports usage and cost", async () => {
    script([{ type: "text", text: "hello " }, { type: "text", text: "world" }])
    const { result, events } = await turn("hi", workspace())
    expect(result.text).toBe("hello world")
    expect(result.usage).toEqual({ input: 10, output: 5, cost: (10 * 1 + 5 * 2) / 1_000_000 })
    expect(events.filter((e) => e.type === "text").map((e) => e.text)).toEqual(["hello ", "world"])
  })

  test("round-trips a tool call and feeds the result back to the model", async () => {
    const cwd = workspace()
    writeFileSync(join(cwd, "hello.txt"), "line one\nline two\n")
    script([{ type: "tool", id: "c1", name: "read", input: { filePath: "hello.txt" } }], [{ type: "text", text: "ok" }])

    const { result, events } = await turn("read hello.txt", cwd)
    const end = events.find((e) => e.type === "tool-end")
    expect(end).toMatchObject({ name: "read", failed: false })
    expect(end && "output" in end && end.output).toContain("line two")
    expect(result.text).toBe("ok")

    // Second call must carry the tool result, otherwise the loop is not closing.
    expect(globalThis.mockCalls).toHaveLength(2)
    expect(JSON.stringify(globalThis.mockCalls[1])).toContain("line two")
  })

  test("surfaces tool failures to the model instead of throwing", async () => {
    script([{ type: "tool", id: "c1", name: "read", input: { filePath: "missing.txt" } }], [
      { type: "text", text: "not there" },
    ])
    const { result, events } = await turn("read it", workspace())
    expect(events.find((e) => e.type === "tool-end")).toMatchObject({ failed: true })
    expect(result.text).toBe("not there")
  })

  test("a denied permission fails the tool without killing the turn", async () => {
    const cwd = workspace()
    script([{ type: "tool", id: "c1", name: "write", input: { filePath: "new.txt", content: "x" } }], [
      { type: "text", text: "denied" },
    ])
    const { events } = await turn("write it", cwd, false)
    const end = events.find((e) => e.type === "tool-end")
    expect(end).toMatchObject({ failed: true })
    expect(end && "output" in end && end.output).toContain("permission denied")
    expect(await Bun.file(join(cwd, "new.txt")).exists()).toBe(false)
  })

  test("the plan agent has no write tools", async () => {
    script([{ type: "text", text: "plan" }])
    await run({
      config,
      cwd: workspace(),
      agent: "plan",
      messages: [{ role: "user", content: "plan it" }],
      gate: new PermissionGate(config.permission, constantAsker(true)),
    })
    const names = toolNames(globalThis.mockCalls[0])
    expect(names).toContain("read")
    expect(names).not.toContain("write")
    expect(names).not.toContain("bash")
  })

  test("delegates to a subagent and returns its text", async () => {
    script(
      [{ type: "tool", id: "c1", name: "task", input: { agent: "plan", prompt: "look around", description: "look" } }],
      [{ type: "text", text: "subagent says hi" }],
      [{ type: "text", text: "relayed" }],
    )
    const { result, events } = await turn("delegate", workspace())
    expect(result.text).toBe("relayed")
    expect(events.filter((e) => e.type === "sub").length).toBeGreaterThan(0)
    const end = events.find((e) => e.type === "tool-end" && e.name === "task")
    expect(end && "output" in end && end.output).toContain("subagent says hi")
  })
})
