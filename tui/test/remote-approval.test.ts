import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { remoteAnswer } from "../src/agent/remote-approval.ts"
import { writeCredentials } from "../src/blueprint/credentials.ts"
import type { PermissionRequest } from "../src/permission.ts"

/**
 * Every path here is explicit. Setting XDG_DATA_HOME would not do: `paths.ts` reads it
 * once at import time, so whichever test file loads first fixes `dataDir` for the whole
 * run — and when that is the real one, writing credentials clobbers the user's device
 * token.
 */
const home = mkdtempSync(join(tmpdir(), "jarvis-approval-"))
const credentialsPath = join(home, "credentials.json")

const REQUEST: PermissionRequest = {
  tool: "bash",
  title: "run `rm -rf build`",
  detail: "rm -rf build",
  detailKind: "text",
  subject: "rm -rf build",
}

/**
 * Stands in for /api/approval. `answer` is what the next poll reports, so a test can have
 * a human answer immediately, never, or after the terminal already did.
 */
class FakeCloud {
  answer: string | null = null
  posts = 0
  polls = 0
  deletes = 0
  postStatus = 200
  readonly server: ReturnType<typeof Bun.serve>

  constructor() {
    this.server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const { pathname } = new URL(request.url)
        if (request.headers.get("authorization") !== "Bearer jvd_test") {
          return Response.json({ error: "Unauthorized" }, { status: 401 })
        }
        if (pathname === "/api/approval" && request.method === "POST") {
          this.posts += 1
          if (this.postStatus !== 200) return Response.json({ error: "boom" }, { status: this.postStatus })
          // A 10ms interval keeps the test fast without a test-only knob in the client:
          // the server advertises its own pace and the client honours it.
          return Response.json({ id: "apr_test", interval: 0.01, expiresIn: 2 })
        }
        if (pathname === "/api/approval/apr_test") {
          if (request.method === "DELETE") {
            this.deletes += 1
            return Response.json({ success: true })
          }
          this.polls += 1
          return Response.json({ answer: this.answer, expired: false })
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

const notes: string[] = []
const note = (text: string) => void notes.push(text)

/**
 * The cancel is fire-and-forget in the client — an agent waiting on a permission must not
 * also wait on the tidy-up — so the test has to give it a moment rather than assume it has
 * already landed.
 */
async function untilDeletes(count: number): Promise<number> {
  for (let i = 0; i < 100; i++) {
    if (cloud.deletes >= count) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return cloud.deletes
}

describe("remoteAnswer", () => {
  test("returns the answer a human gave elsewhere", async () => {
    cloud.answer = "once"
    const answer = await remoteAnswer(REQUEST, new AbortController().signal, note, credentialsPath)
    expect(answer).toBe("once")
    // The prompt is taken off the other devices either way.
    expect(await untilDeletes(1)).toBeGreaterThan(0)
  })

  test("passes a rejection through", async () => {
    cloud.answer = "reject"
    expect(await remoteAnswer(REQUEST, new AbortController().signal, note, credentialsPath)).toBe("reject")
  })

  test("gives up when the terminal answers first, and cancels the remote row", async () => {
    cloud.answer = null
    const before = cloud.deletes
    const controller = new AbortController()
    const pending = remoteAnswer(REQUEST, controller.signal, note, credentialsPath)
    // What `ask` does the moment somebody presses y/n at the terminal.
    setTimeout(() => controller.abort(), 30)
    expect(await pending).toBeUndefined()
    expect(await untilDeletes(before + 1)).toBe(before + 1)
  })

  test("degrades to the terminal when the server rejects the request", async () => {
    cloud.answer = "once"
    cloud.postStatus = 500
    const polls = cloud.polls
    expect(await remoteAnswer(REQUEST, new AbortController().signal, note, credentialsPath)).toBeUndefined()
    // Never started polling, and never threw into the permission gate.
    expect(cloud.polls).toBe(polls)
    cloud.postStatus = 200
  })

  test("stops at the deadline without answering", async () => {
    cloud.answer = null
    // expiresIn is 2s in the fake; nothing should come back but undefined.
    expect(await remoteAnswer(REQUEST, new AbortController().signal, note, credentialsPath)).toBeUndefined()
  }, 10_000)

  test("does nothing at all when the device is not paired", async () => {
    rmSync(credentialsPath)
    const posts = cloud.posts
    expect(await remoteAnswer(REQUEST, new AbortController().signal, note, credentialsPath)).toBeUndefined()
    expect(cloud.posts).toBe(posts)
    writeCredentials(
      { baseUrl: cloud.baseUrl, deviceId: "dev_test", token: "jvd_test", workstationId: "wks_test" },
      credentialsPath,
    )
  })
})
