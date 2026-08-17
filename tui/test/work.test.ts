import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { within, work } from "../src/cli/work.ts"
import { writeCredentials } from "../src/blueprint/credentials.ts"
import type { Config } from "../src/config/config.ts"

describe("within", () => {
  test("accepts the root itself and anything under it", () => {
    expect(within("/a/b", "/a/b")).toBe(true)
    expect(within("/a/b", "/a/b/c/d")).toBe(true)
  })

  test("rejects escapes, siblings, and prefix look-alikes", () => {
    expect(within("/a/b", "/a")).toBe(false)
    expect(within("/a/b", "/a/c")).toBe(false)
    // The one a naive `startsWith` gets wrong.
    expect(within("/a/b", "/a/bc")).toBe(false)
  })
})

/**
 * The containment guard through the real loop: a job pointing outside `--root` must be
 * refused and reported, and must never reach the agent. Jobs run with every permission
 * auto-approved, so this is the boundary that matters most in the whole feature.
 */
describe("work", () => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-work-"))
  let claims = 0
  const results: { jobId: string; ok: boolean; error?: string }[] = []

  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      if (pathname === "/api/device/automation/claim") {
        claims += 1
        // One escaping job, then nothing.
        if (claims > 1) return Response.json({ job: null })
        return Response.json({
          job: { id: "ajb_bad", prompt: "do something", cwd: "../../etc", model: "", timeoutSec: 30 },
        })
      }
      if (pathname === "/api/device/automation/result") {
        results.push((await request.json()) as (typeof results)[number])
        return Response.json({ success: true })
      }
      return Response.json({ error: "not_found" }, { status: 404 })
    },
  })

  beforeAll(() => {
    writeCredentials(
      { baseUrl: `http://localhost:${server.port}`, deviceId: "dev_test", token: "jvd_test", workstationId: "wks_test" },
      join(home, "credentials.json"),
    )
  })

  afterAll(() => {
    server.stop(true)
    rmSync(home, { recursive: true, force: true })
  })

  test("refuses a job whose cwd escapes --root, without running an agent", async () => {
    await work({
      config: {} as Config,
      root: resolve(home),
      intervalMs: 1,
      maxPolls: 2,
      credentialsPath: join(home, "credentials.json"),
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.ok).toBe(false)
    expect(results[0]!.error).toContain("outside")
  })
})
