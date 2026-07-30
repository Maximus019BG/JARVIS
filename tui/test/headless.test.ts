import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { latestSession, listSessions } from "../src/agent/session.ts"
import { runHeadless } from "../src/cli/headless.ts"
import { ConfigSchema } from "../src/config/config.ts"
import type { MockPart } from "./fixtures/mock-provider.ts"

const config = ConfigSchema.parse({
  model: "mock/test",
  provider: {
    mock: { npm: join(import.meta.dir, "fixtures", "mock-provider.ts"), export: "createMock", models: { test: {} } },
  },
})

function script(...steps: MockPart[][]) {
  globalThis.mockSteps = steps
  globalThis.mockCalls = []
}

const workspace = () => mkdtempSync(join(tmpdir(), "jarvis-headless-"))

beforeEach(() => script())

describe("runHeadless", () => {
  test("refuses an empty prompt", () => {
    expect(runHeadless({ config, prompt: "  ", yes: true, cwd: workspace() })).rejects.toThrow(/nothing to do/)
  })

  test("persists the turn so the session can be resumed", async () => {
    const cwd = workspace()
    script([{ type: "text", text: "hello" }])
    await runHeadless({ config, prompt: "say hi", yes: true, cwd })

    const session = latestSession(cwd)
    expect(session?.messages).toHaveLength(2)
    expect(session?.title).toBe("say hi")
  })

  test("--continue keeps one session and carries the history into the next turn", async () => {
    const cwd = workspace()
    script([{ type: "text", text: "first" }])
    await runHeadless({ config, prompt: "one", yes: true, cwd })

    script([{ type: "text", text: "second" }])
    await runHeadless({ config, prompt: "two", yes: true, cwd, resume: true })

    expect(listSessions(cwd)).toHaveLength(1)
    expect(latestSession(cwd)?.messages).toHaveLength(4)
    // The second call must have been given the first exchange, not just the new prompt.
    expect(JSON.stringify(globalThis.mockCalls[0])).toContain("first")
  })

  test("without --continue each run starts its own session", async () => {
    const cwd = workspace()
    script([{ type: "text", text: "a" }])
    await runHeadless({ config, prompt: "one", yes: true, cwd })
    script([{ type: "text", text: "b" }])
    await runHeadless({ config, prompt: "two", yes: true, cwd })

    expect(listSessions(cwd)).toHaveLength(2)
  })
})
