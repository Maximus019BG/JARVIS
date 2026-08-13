import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { claimPrompt } from "../src/agent/remote-prompt.ts"
import { writeCredentials } from "../src/blueprint/credentials.ts"

/**
 * Every path here is explicit, for the same reason `remote-approval.test.ts` says so:
 * `paths.ts` fixes `dataDir` at import time, so setting XDG_DATA_HOME would clobber the
 * real device token depending on which test file happened to load first.
 */
const home = mkdtempSync(join(tmpdir(), "jarvis-steer-"))
const credentialsPath = join(home, "credentials.json")

/**
 * Stands in for /api/device/prompt/claim. `queue` is what is waiting, and the fake pops it
 * exactly like the real conditional UPDATE does — a claim is spent, so the same prompt can
 * never come back twice.
 */
class FakeCloud {
  queue: string[] = []
  claims = 0
  status = 200
  /** Session ids the poll asked about, so the test can prove it scopes its request. */
  asked: string[] = []
  readonly server: ReturnType<typeof Bun.serve>

  constructor() {
    this.server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const { pathname } = new URL(request.url)
        if (request.headers.get("authorization") !== "Bearer jvd_test") {
          return Response.json({ error: "Unauthorized" }, { status: 401 })
        }
        if (pathname === "/api/device/prompt/claim" && request.method === "POST") {
          this.claims += 1
          if (this.status !== 200) return Response.json({ error: "boom" }, { status: this.status })
          const body = (await request.json()) as { sessionId?: string }
          this.asked.push(String(body.sessionId))
          const prompt = this.queue.shift()
          return Response.json({ prompt: prompt ? { id: "spr_test", prompt } : null })
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

beforeAll(() => {
  cloud = new FakeCloud()
  writeCredentials(
    { baseUrl: cloud.baseUrl, deviceId: "dev_test", token: "jvd_test", workstationId: "wks_test" },
    credentialsPath,
  )
})

afterAll(() => {
  cloud.server.stop(true)
  rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  cloud.queue = []
  cloud.asked = []
  cloud.status = 200
})

describe("claimPrompt", () => {
  test("returns the prompt somebody queued for this session", async () => {
    cloud.queue.push("look at the failing test instead")
    expect(await claimPrompt("ses_a", undefined, credentialsPath)).toBe("look at the failing test instead")
    expect(cloud.asked).toEqual(["ses_a"])
  })

  test("hands out each prompt once", async () => {
    cloud.queue.push("first", "second")
    expect(await claimPrompt("ses_a", undefined, credentialsPath)).toBe("first")
    expect(await claimPrompt("ses_a", undefined, credentialsPath)).toBe("second")
    expect(await claimPrompt("ses_a", undefined, credentialsPath)).toBeUndefined()
  })

  test("nothing waiting is undefined, not an error", async () => {
    expect(await claimPrompt("ses_a", undefined, credentialsPath)).toBeUndefined()
  })

  test("a server failure is undefined rather than a throw into the render loop", async () => {
    cloud.status = 500
    cloud.queue.push("never delivered")
    expect(await claimPrompt("ses_a", undefined, credentialsPath)).toBeUndefined()
  })

  test("an unpaired machine never calls out at all", async () => {
    const before = cloud.claims
    expect(await claimPrompt("ses_a", undefined, join(home, "absent.json"))).toBeUndefined()
    expect(cloud.claims).toBe(before)
  })

  test("a blank prompt is refused rather than starting an empty turn", async () => {
    cloud.queue.push("   ")
    expect(await claimPrompt("ses_a", undefined, credentialsPath)).toBeUndefined()
  })

  test("an aborted poll resolves undefined instead of rejecting", async () => {
    const controller = new AbortController()
    controller.abort()
    cloud.queue.push("too late")
    expect(await claimPrompt("ses_a", controller.signal, credentialsPath)).toBeUndefined()
  })
})
