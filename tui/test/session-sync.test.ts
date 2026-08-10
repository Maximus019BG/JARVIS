import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lineCount, metricsFor, pushSessions } from "../src/agent/session-sync.ts"
import { writeCredentials } from "../src/blueprint/credentials.ts"
import type { Config } from "../src/config/config.ts"
import { sessionDir } from "../src/config/paths.ts"
import type { MetricRecord } from "../src/agent/metrics.ts"

/**
 * `sessionDir` is fixed at import time from the ambient data dir, so this suite writes its
 * fixture sessions there under unmistakable ids and removes them again — rather than
 * setting XDG_DATA_HOME, which whichever test file loads first has already decided.
 */
const IDS = ["ses_synctest_a", "ses_synctest_b"] as const
const [FIRST] = IDS
const home = mkdtempSync(join(tmpdir(), "jarvis-sync-"))
const credentialsPath = join(home, "credentials.json")

function writeSession(id: string, messages: number) {
  mkdirSync(sessionDir, { recursive: true })
  const lines = [
    JSON.stringify({ type: "header", header: { id, cwd: "/tmp/project", created: 1_700_000_000_000, title: id } }),
    ...Array.from({ length: messages }, (_, i) =>
      JSON.stringify({ type: "message", message: { role: i % 2 ? "assistant" : "user", content: `m${i}` } }),
    ),
  ]
  writeFileSync(join(sessionDir, `${id}.jsonl`), `${lines.join("\n")}\n`)
}

type Push = { id: string; lines: number; transcript: string; turns: number; costMicros: number }

class FakeCloud {
  /** id → line count, exactly as the real server's cursor behaves. */
  have = new Map<string, number>()
  pushes: Push[] = []
  readonly server: ReturnType<typeof Bun.serve>

  constructor() {
    this.server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const { pathname } = new URL(request.url)
        if (request.headers.get("authorization") !== "Bearer jvd_test") {
          return Response.json({ error: "Unauthorized" }, { status: 401 })
        }
        if (pathname === "/api/session/list") {
          return Response.json({ sessions: [...this.have].map(([id, lines]) => ({ id, lines })) })
        }
        if (pathname === "/api/session/push") {
          const body = (await request.json()) as Push
          this.pushes.push(body)
          this.have.set(body.id, body.lines)
          return Response.json({ success: true, lines: body.lines })
        }
        return Response.json({ error: "not_found" }, { status: 404 })
      },
    })
  }

  get baseUrl() {
    return `http://localhost:${this.server.port}`
  }
}

let cloud: FakeCloud
const config = (syncSessions: boolean) => ({ syncSessions }) as unknown as Config

beforeAll(() => {
  cloud = new FakeCloud()
  writeCredentials(
    { baseUrl: cloud.baseUrl, deviceId: "dev_test", token: "jvd_test", workstationId: "wks_test" },
    credentialsPath,
  )
  for (const [index, id] of IDS.entries()) writeSession(id, 2 + index * 2)
})

afterAll(() => {
  cloud.server.stop(true)
  rmSync(home, { recursive: true, force: true })
  for (const id of IDS) rmSync(join(sessionDir, `${id}.jsonl`), { force: true })
})

beforeEach(() => {
  cloud.pushes = []
  cloud.have.clear()
})

const ours = (pushes: Push[]) => pushes.filter((push) => (IDS as readonly string[]).includes(push.id))

describe("pushSessions", () => {
  test("uploads nothing at all when syncSessions is off", async () => {
    const result = await pushSessions(config(false), { credentialsPath })
    expect(result.pushed).toEqual([])
    expect(cloud.pushes).toEqual([])
  })

  test("uploads a session the server has never seen", async () => {
    const result = await pushSessions(config(true), { credentialsPath })
    expect(result.pushed).toContain(FIRST)
    const pushed = ours(cloud.pushes).find((push) => push.id === FIRST)!
    // Header plus two messages.
    expect(pushed.lines).toBe(3)
    expect(pushed.transcript).toContain('"m0"')
  })

  test("skips a session the server already has in full", async () => {
    await pushSessions(config(true), { credentialsPath })
    cloud.pushes = []
    await pushSessions(config(true), { credentialsPath })
    // The cursor matched on the second sweep, so nothing was re-sent.
    expect(ours(cloud.pushes)).toEqual([])
  })

  test("re-uploads a session that has grown since", async () => {
    await pushSessions(config(true), { credentialsPath })
    cloud.pushes = []
    writeSession(FIRST, 6)
    await pushSessions(config(true), { credentialsPath })
    expect(ours(cloud.pushes).map((push) => push.id)).toEqual([FIRST])
    expect(ours(cloud.pushes)[0]!.lines).toBe(7)
  })

  test("leaves the live session alone", async () => {
    await pushSessions(config(true), { skip: FIRST, credentialsPath })
    expect(ours(cloud.pushes).map((push) => push.id)).not.toContain(FIRST)
  })

  test("does nothing when the device is not paired", async () => {
    const result = await pushSessions(config(true), { credentialsPath: join(home, "absent.json") })
    expect(result.pushed).toEqual([])
    expect(cloud.pushes).toEqual([])
  })
})

describe("lineCount", () => {
  test("counts non-empty lines, trailing newline and all", () => {
    expect(lineCount('{"a":1}\n{"b":2}\n')).toBe(2)
    expect(lineCount("")).toBe(0)
    // Byte length would have shifted here; the line count must not.
    expect(lineCount('{"a":1}\n\n{"b":2}')).toBe(2)
  })
})

describe("metricsFor", () => {
  const records: MetricRecord[] = [
    { at: 1, ms: 1, provider: "p", model: "m", input: 10, output: 5, cost: 0.5, session: "ses_x" },
    { at: 2, ms: 1, provider: "p", model: "m", input: 20, output: 7, cost: 0.25, session: "ses_x" },
    { at: 3, ms: 1, provider: "p", model: "m", input: 99, output: 99, cost: 9, session: "ses_y" },
    // Predates session tagging: must not land on anybody's total.
    { at: 4, ms: 1, provider: "p", model: "m", input: 99, output: 99, cost: 9 },
  ]

  test("sums one session's turns, tokens and cost in micros", () => {
    expect(metricsFor("ses_x", records)).toEqual({
      turns: 2,
      inputTokens: 30,
      outputTokens: 12,
      costMicros: 750_000,
    })
  })

  test("is all zeroes for a session with no recorded turns", () => {
    expect(metricsFor("ses_missing", records)).toEqual({
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
    })
  })
})
