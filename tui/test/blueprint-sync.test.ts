import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Credentials } from "../src/blueprint/credentials.ts"
import { applyOps, type Op } from "../src/blueprint/ops.ts"
import { BlueprintDocSchema, emptyDoc, serialize, type BlueprintDoc } from "../src/blueprint/schema.ts"
import { ensureRepo, history, readDoc, writeDoc } from "../src/blueprint/store.ts"
import { pull, push, status } from "../src/blueprint/sync.ts"

/**
 * A stand-in for the push/pull endpoints, so the protocol — fast-forward, 409 on
 * divergence, merge, re-push — is exercised without a Postgres. The real routes enforce
 * grants and rate limits; those live on the server and are not what this file is about.
 */
type Version = {
  sha: string | null
  parentSha: string | null
  message: string
  version: number
  blueprintId: string
  doc: BlueprintDoc
}

class FakeCloud {
  versions: Version[] = []
  pushes = 0
  lastIdempotencyKey?: string
  readonly server: ReturnType<typeof Bun.serve>

  constructor() {
    this.server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url)

        if (url.pathname === "/api/blueprint/push") {
          this.pushes += 1
          this.lastIdempotencyKey = request.headers.get("idempotency-key") ?? undefined
          const body = (await request.json()) as {
            blueprintId: string
            commits: { sha: string; parentSha: string | null; message: string; doc: unknown }[]
          }
          const mine = this.versions.filter((version) => version.blueprintId === body.blueprintId)
          const known = new Set(mine.map((version) => version.sha))
          const fresh = body.commits.filter((commit) => !known.has(commit.sha))
          if (fresh.length === 0) {
            return Response.json({ success: true, applied: 0, head: mine.at(-1)?.sha ?? null, upToDate: true })
          }
          const head = mine.at(-1)
          if (head && fresh[0]!.parentSha !== head.sha) {
            return Response.json(
              {
                error: "diverged",
                serverHead: head.sha,
                serverParent: head.parentSha,
                serverVersion: head.version,
                serverDoc: head.doc,
              },
              { status: 409 },
            )
          }
          for (const commit of fresh) {
            this.versions.push({
              sha: commit.sha,
              parentSha: commit.parentSha,
              message: commit.message,
              version: mine.length + fresh.indexOf(commit) + 1,
              blueprintId: body.blueprintId,
              doc: BlueprintDocSchema.parse(commit.doc),
            })
          }
          return Response.json({
            success: true,
            applied: fresh.length,
            head: fresh.at(-1)!.sha,
            version: mine.length + fresh.length,
          })
        }

        if (url.pathname === "/api/blueprint/pull") {
          // Scoped by blueprint, exactly like the real endpoint.
          const mine = this.versions.filter(
            (version) => version.blueprintId === url.searchParams.get("blueprintId"),
          )
          const since = url.searchParams.get("since")
          const index = since ? mine.findIndex((version) => version.sha === since) : -1
          const commits = index >= 0 ? mine.slice(index + 1) : mine
          return Response.json({
            success: true,
            name: "plate",
            commits: commits.map((version) => ({ ...version, doc: version.doc })),
            truncated: false,
          })
        }

        return new Response("not found", { status: 404 })
      },
    })
  }

  head(blueprintId?: string): Version | undefined {
    const scoped = blueprintId
      ? this.versions.filter((version) => version.blueprintId === blueprintId)
      : this.versions
    return scoped.at(-1)
  }

  get url(): string {
    return `http://localhost:${this.server.port}`
  }

  /** A version the client has never seen, as if pushed by another device. */
  seedForeign(doc: BlueprintDoc, sha: string, parentSha: string | null) {
    const mine = this.versions.filter((version) => version.blueprintId === doc.id)
    this.versions.push({
      sha,
      parentSha,
      message: "from another device",
      version: mine.length + 1,
      blueprintId: doc.id,
      doc,
    })
  }

  stop() {
    this.server.stop(true)
  }
}

const line = (a: [number, number], b: [number, number]): Op => ({ op: "add", entity: { type: "line", a, b } })

let cloud: FakeCloud
let root: string
let creds: Credentials

function seedLocal(): BlueprintDoc {
  writeDoc(root, "plate", emptyDoc("plate"), "create")
  const doc = applyOps(readDoc(root, "plate"), [line([0, 0], [10, 0])]).doc
  writeDoc(root, "plate", doc, "add baseline")
  return readDoc(root, "plate")
}

beforeAll(() => {
  cloud = new FakeCloud()
  root = mkdtempSync(join(tmpdir(), "jarvis-sync-"))
  ensureRepo(root)
  // Passed in explicitly rather than through the real credentials file: `dataDir` is
  // resolved at module load, so an env var set here would come too late.
  creds = { baseUrl: cloud.url, deviceId: "dev_test", token: "jvd_test", workstationId: "ws_test" }
})

afterAll(() => {
  cloud.stop()
  rmSync(root, { recursive: true, force: true })
})

describe("sync", () => {
  test("push sends every local commit and reports the new head", async () => {
    seedLocal()
    const result = await push(root, "plate", creds)
    expect(result.status).toBe("pushed")
    if (result.status !== "pushed") return
    expect(result.applied).toBe(2)
    expect(cloud.versions.filter((v) => v.blueprintId === readDoc(root, "plate").id)).toHaveLength(2)
    expect(result.head).toBe(history(root, "plate")[0]!.sha)
  })

  test("pushing again is a no-op rather than a duplicate", async () => {
    const result = await push(root, "plate", creds)
    expect(result.status).toBe("up-to-date")
    expect(cloud.versions.filter((v) => v.blueprintId === readDoc(root, "plate").id)).toHaveLength(2)
  })

  test("push carries an idempotency key so a lost reply can be retried safely", () => {
    expect(cloud.lastIdempotencyKey).toContain(":")
  })

  test("status compares local and server heads", async () => {
    const state = await status(root, "plate", creds)
    expect(state.paired).toBe(true)
    const head = cloud.head(readDoc(root, "plate").id)!.sha ?? undefined
    expect(state.localHead).toBe(head)
    expect(state.serverHead).toBe(head)
  })

  test("a diverged push merges against the server and pushes the merge", async () => {
    // Another device moved e1 and pushed; we moved it differently, without pulling.
    const shared = readDoc(root, "plate")
    const remote = applyOps(shared, [{ op: "move", ids: ["e1"], by: [0, 25] }]).doc
    cloud.seedForeign(remote, "feed001", cloud.head(shared.id)!.sha)

    const ours = applyOps(shared, [{ op: "move", ids: ["e1"], by: [40, 0] }]).doc
    writeDoc(root, "plate", ours, "move baseline right")

    const before = cloud.pushes
    const result = await push(root, "plate", creds)

    expect(result.status).toBe("merged")
    if (result.status !== "merged") return
    // One rejected push, then the merge push.
    expect(cloud.pushes).toBe(before + 2)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toContain("e1")
    expect(result.renamed[0]).toBe("e1 → e1-b")

    // Both versions of the contested line survived, locally and on the server.
    const merged = readDoc(root, "plate")
    expect(merged.entities.find((entity) => entity.id === "e1")).toMatchObject({ a: [40, 0] })
    expect(merged.entities.find((entity) => entity.id === "e1-b")).toMatchObject({ a: [0, 25] })
    expect(serialize(cloud.head(merged.id)!.doc)).toBe(serialize(merged))
  })

  test("the merge is a real commit in local history", () => {
    expect(history(root, "plate")[0]!.message).toContain("merge")
  })

  test("pull fast-forwards when the server is ahead and we are not", async () => {
    const name = "bracket"
    writeDoc(root, name, emptyDoc(name), "create")
    const local = readDoc(root, name)
    await push(root, name, creds)

    const ahead = applyOps(local, [line([1, 1], [2, 2])]).doc
    cloud.seedForeign(ahead, "cafe002", cloud.head(local.id)!.sha)

    const result = await pull(root, name, creds)
    expect(result.status).toBe("fast-forward")
    expect(readDoc(root, name).entities).toHaveLength(1)
  })

  test("pull with nothing new leaves the working copy alone", async () => {
    const before = serialize(readDoc(root, "bracket"))
    const result = await pull(root, "bracket", creds)
    expect(result.status).toBe("up-to-date")
    expect(serialize(readDoc(root, "bracket"))).toBe(before)
  })

  test("push refuses when the device is not paired", async () => {
    // No credentials passed and none on disk in this environment.
    await expect(push(root, "plate", undefined)).rejects.toThrow(/not paired/)
  })
})
