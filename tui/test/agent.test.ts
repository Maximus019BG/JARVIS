import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { errorMessage, run, type AgentEvent } from "../src/agent/agent.ts"
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

describe("errorMessage", () => {
  test("reads a real Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage(new TypeError("wrong type"))).toBe("wrong type")
  })

  test("never returns [object Object]", () => {
    // The bug this exists to stop: a thrown plain object rendered as "[object Object]"
    // in the transcript, telling the user nothing at all.
    for (const thrown of [{}, { code: 500 }, [], { toString: null }]) {
      expect(errorMessage(thrown)).not.toBe("[object Object]")
    }
  })

  test("digs the message out of an object that is not an Error", () => {
    // A bundled copy of a provider SDK is a different realm, so its errors fail
    // `instanceof Error` while carrying a perfectly good message.
    expect(errorMessage({ message: "rate limited" })).toBe("rate limited")
    expect(errorMessage({ error: "upstream refused" })).toBe("upstream refused")
    expect(errorMessage({ error: { message: "invalid api key" } })).toBe("invalid api key")
  })

  test("falls back to JSON rather than to nothing", () => {
    expect(errorMessage({ code: 429, retryAfter: 30 })).toBe('{"code":429,"retryAfter":30}')
  })

  test("passes strings and primitives through", () => {
    expect(errorMessage("plain string")).toBe("plain string")
    expect(errorMessage(undefined)).toBe("undefined")
  })
})

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

  test("an interrupted turn reports itself and keeps the steps it finished", async () => {
    const cwd = workspace()
    writeFileSync(join(cwd, "hello.txt"), "line one\n")
    script([{ type: "tool", id: "c1", name: "read", input: { filePath: "hello.txt" } }], [{ type: "text", text: "ok" }])

    const controller = new AbortController()
    const result = await run({
      config,
      cwd,
      messages: [{ role: "user", content: "read it" }],
      gate: new PermissionGate(config.permission, constantAsker(true)),
      abort: controller.signal,
      // Interrupt once the first step has produced its tool result.
      onEvent: (event) => {
        if (event.type === "tool-end") controller.abort()
      },
    })

    expect(result.interrupted).toBe(true)
    // The finished step survives, with the call and its result paired.
    const serialized = JSON.stringify(result.messages)
    expect(serialized).toContain("c1")
    expect(serialized).toContain("line one")
    // The model was never asked for the second step.
    expect(globalThis.mockCalls).toHaveLength(1)
  })

  test("reads carry across turns when the caller owns the map", async () => {
    const cwd = workspace()
    writeFileSync(join(cwd, "a.txt"), "one\n")
    const read = new Map<string, number>()
    const gate = new PermissionGate(config.permission, constantAsker(true))
    const messages = [{ role: "user" as const, content: "go" }]

    script([{ type: "tool", id: "c1", name: "read", input: { filePath: "a.txt" } }], [{ type: "text", text: "read it" }])
    await run({ config, cwd, messages, gate, read })

    // A second turn edits without re-reading; the shared map is what makes that legal.
    script([{ type: "tool", id: "c2", name: "edit", input: { filePath: "a.txt", oldString: "one", newString: "two" } }], [
      { type: "text", text: "edited" },
    ])
    const { events } = await (async () => {
      const events: AgentEvent[] = []
      await run({ config, cwd, messages, gate, read, onEvent: (event) => events.push(event) })
      return { events }
    })()

    expect(events.find((e) => e.type === "tool-end" && e.name === "edit")).toMatchObject({ failed: false })
    expect(await Bun.file(join(cwd, "a.txt")).text()).toBe("two\n")
  })

  test("retries a failed_generation step instead of surfacing the gateway error", async () => {
    const cwd = workspace()
    writeFileSync(join(cwd, "hello.txt"), "hello\n")
    script(
      [{ type: "failed-generation", text: "Failed to call a function. Please adjust your prompt." }],
      [{ type: "tool", id: "c1", name: "read", input: { filePath: "hello.txt" } }],
      [{ type: "text", text: "retried ok" }],
    )

    const { result, events } = await turn("read hello.txt", cwd)
    expect(result.text).toBe("retried ok")
    // The failed attempt, the tool-call step, then the closing text step.
    expect(globalThis.mockCalls).toHaveLength(3)
    // The retry hint reached the model on the second attempt.
    expect(JSON.stringify(globalThis.mockCalls[1])).toContain("failed to produce a valid tool call")
    // The gateway's refusal text is noise — it must not reach the transcript or the model.
    expect(events.some((e) => e.type === "error" && e.message.includes("retrying"))).toBe(true)
    expect(result.messages.some((m) => "content" in m && String(m.content).includes("Failed to call"))).toBe(false)
  })

  test("gives up on failed_generation after the retries are spent, keeping the last error", async () => {
    script(
      [{ type: "failed-generation", text: "Failed to call a function." }],
      [{ type: "failed-generation", text: "Failed to call a function." }],
      [{ type: "failed-generation", text: "Failed to call a function." }],
    )
    const { result, events } = await turn("do something", workspace())
    // 1 attempt + MAX_RETRIES(2) = 3 model calls, all refused.
    expect(globalThis.mockCalls).toHaveLength(3)
    const retries = events.filter((e) => e.type === "error" && e.message.includes("retrying"))
    expect(retries).toHaveLength(2)
    // The final attempt's refusal text is the last thing on screen.
    expect(result.text).toContain("Failed to call a function")
    // And an explanation lands so the raw gateway text is not all the user gets.
    expect(events.some((e) => e.type === "error" && e.message.includes("weak at tool calling"))).toBe(true)
  })

  test("retries when the refusal arrives as plain text under finish reason `stop`", async () => {
    const cwd = workspace()
    writeFileSync(join(cwd, "hello.txt"), "hello\n")
    // A refusal that Groq emits as assistant text with a normal `stop` finish reason.
    script([{ type: "text", text: "Failed to call a function. Please adjust your prompt." }], [
      { type: "tool", id: "c1", name: "read", input: { filePath: "hello.txt" } },
    ], [
      { type: "text", text: "retried ok" },
    ])
    const { result, events } = await turn("read hello.txt", cwd)
    expect(result.text).toBe("retried ok")
    expect(globalThis.mockCalls).toHaveLength(3)
    expect(events.some((e) => e.type === "error" && e.message.includes("retrying"))).toBe(true)
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
