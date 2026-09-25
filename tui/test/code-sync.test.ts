import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeCredentials } from "../src/blueprint/credentials.ts"
import { createProject, headSha, initProject, projectAt, unmerged } from "../src/code/project.ts"
import { clone, pullCloud, pushCloud, pushRemote } from "../src/code/sync.ts"

/**
 * Stand-in for `/api/code/push` and `/api/code/pull`: an ordered bundle log with a
 * fast-forward check, which is all the real route does besides auth and rate limits.
 */
type Version = { sha: string; version: number; bundle: string; files: Record<string, string> }

class FakeCloud {
  projects = new Map<string, { name: string; versions: Version[] }>()
  readonly server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/code/push") {
        const body = (await request.json()) as {
          projectId: string
          name: string
          baseSha: string | null
          headSha: string
          bundle: string
          files: Record<string, string>
        }
        const project = this.projects.get(body.projectId) ?? { name: body.name, versions: [] }
        const head = project.versions.at(-1)
        if (head?.sha === body.headSha) return Response.json({ success: true, version: head.version, head: head.sha, upToDate: true })
        if ((head?.sha ?? null) !== body.baseSha) {
          return Response.json({ error: "diverged", serverHead: head?.sha, serverVersion: head?.version }, { status: 409 })
        }
        const version = project.versions.length + 1
        project.versions.push({ sha: body.headSha, version, bundle: body.bundle, files: body.files })
        this.projects.set(body.projectId, project)
        return Response.json({ success: true, version, head: body.headSha })
      }
      if (url.pathname === "/api/code/pull") {
        const id = url.searchParams.get("projectId")
        if (!id) {
          return Response.json({
            success: true,
            projects: [...this.projects].map(([key, project]) => ({
              id: key,
              name: project.name,
              version: project.versions.length,
              headSha: project.versions.at(-1)?.sha ?? null,
              updatedAt: new Date().toISOString(),
            })),
          })
        }
        const project = this.projects.get(id)
        if (!project) return Response.json({ error: "not_found" }, { status: 404 })
        const since = project.versions.find((entry) => entry.sha === url.searchParams.get("since"))?.version ?? 0
        return Response.json({
          success: true,
          name: project.name,
          head: project.versions.at(-1)?.sha ?? null,
          version: project.versions.length,
          bundles: project.versions.filter((entry) => entry.version > since),
        })
      }
      return new Response("not found", { status: 404 })
    },
  })
}

let cloud: FakeCloud
const temps: string[] = []
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-code-"))
  temps.push(dir)
  return dir
}

beforeAll(() => {
  cloud = new FakeCloud()
  writeCredentials({ baseUrl: `http://localhost:${cloud.server.port}`, deviceId: "d1", token: "jvd_x", workstationId: "w1" })
})
afterAll(() => {
  cloud.server.stop(true)
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

describe("code sync", () => {
  test("push, clone, divergent edits merge, same-line edits conflict", async () => {
    const a = createProject(temp(), "demo")
    writeFileSync(join(a.dir, "main.py"), "print('a')\n")
    expect(await pushCloud(a)).toContain("pushed demo")
    expect(cloud.projects.get(a.id)!.versions[0]!.files["main.py"]).toBe("print('a')\n")

    const otherWorkspace = temp()
    expect(await clone(otherWorkspace, "demo")).toContain("cloned demo")
    const b = projectAt(join(otherWorkspace, "demo"))!
    expect(b.id).toBe(a.id)
    expect(headSha(b.dir)).toBe(headSha(a.dir))

    // Different files on each side: B pushes first, A's push gets a 409 and merges cleanly.
    writeFileSync(join(b.dir, "b.txt"), "from b\n")
    await pushCloud(b)
    writeFileSync(join(a.dir, "a.txt"), "from a\n")
    expect(await pushCloud(a)).toContain("merged with the cloud and pushed")
    expect(readFileSync(join(a.dir, "b.txt"), "utf8")).toBe("from b\n")

    expect(await pullCloud(b)).toContain("now at cloud")
    expect(readFileSync(join(b.dir, "a.txt"), "utf8")).toBe("from a\n")

    // Same line on both sides: reported, markers left for a human, nothing pushed.
    writeFileSync(join(b.dir, "main.py"), "print('b')\n")
    await pushCloud(b)
    writeFileSync(join(a.dir, "main.py"), "print('A')\n")
    const versions = cloud.projects.get(a.id)!.versions.length
    expect(await pushCloud(a)).toContain("conflicts in")
    expect(unmerged(a.dir)).toEqual(["main.py"])
    expect(cloud.projects.get(a.id)!.versions.length).toBe(versions)
    await expect(pushCloud(a)).rejects.toThrow("resolve the conflicts first")

    writeFileSync(join(a.dir, "main.py"), "print('ab')\n")
    expect(await pushCloud(a)).toContain("pushed demo")
    expect(await pullCloud(b)).toContain("now at cloud")
    expect(readFileSync(join(b.dir, "main.py"), "utf8")).toBe("print('ab')\n")
  })

  test("auto-sync style abort leaves the working tree clean", async () => {
    const a = createProject(temp(), "abort")
    await pushCloud(a)
    const workspace = temp()
    await clone(workspace, "abort")
    const b = projectAt(join(workspace, "abort"))!
    writeFileSync(join(b.dir, "README.md"), "b\n")
    await pushCloud(b)
    writeFileSync(join(a.dir, "README.md"), "a\n")
    await expect(pushCloud(a, { abortOnConflict: true })).rejects.toThrow("conflicts with the cloud")
    expect(unmerged(a.dir)).toEqual([])
    expect(readFileSync(join(a.dir, "README.md"), "utf8")).toBe("a\n")
  })

  test("init reuses the enclosing repo and pushes to a plain git remote", async () => {
    const bare = temp()
    Bun.spawnSync(["git", "init", "--quiet", "--bare", bare])
    const dir = temp()
    Bun.spawnSync(["git", "init", "--quiet", "--initial-branch=main", dir])
    const project = initProject(join(dir, "sub"))
    expect(project.dir).toBe(projectAt(dir)!.dir)
    expect(initProject(dir).id).toBe(project.id)

    Bun.spawnSync(["git", "remote", "add", "origin", bare], { cwd: dir })
    writeFileSync(join(dir, "x.txt"), "x\n")
    expect(await pushRemote(project, "origin")).toBe(`pushed ${project.name} to origin/main`)
    const log = Bun.spawnSync(["git", "log", "--format=%H", "-1", "main"], { cwd: bare }).stdout.toString().trim()
    expect(log).toBe(headSha(dir)!)
  })
})
