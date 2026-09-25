// Bun-only: talks to the cloud and to git remotes. Every function answers with the line a
// person should read, because the `/code` command and the `code_project` tool say the same.
import { mkdirSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { readCredentials, requireCredentials, type Credentials } from "../blueprint/credentials.ts"
import { git, safeName } from "../blueprint/store.ts"
import { call } from "../blueprint/sync.ts"
import type { Config } from "../config/config.ts"
import {
  applyBundles,
  bundleSince,
  cloudSha,
  commitAll,
  currentBranch,
  findProjects,
  gitRemote,
  headSha,
  lastMessage,
  remotes,
  setCloudSha,
  snapshot,
  unmerged,
  projectAt,
  type Project,
} from "./project.ts"

export type Target = "cloud" | (string & {})

type Listed = { id: string; name: string; version: number; headSha: string | null; updatedAt: string }
type PullBody = { success: true; name: string; head: string | null; version: number; bundles: { sha: string; version: number; bundle: string }[] }
type PushBody = { success: true; version: number; head: string; upToDate?: boolean }

function failure(what: string, result: { status: number; body: unknown }): Error {
  const hint =
    result.status === 403
      ? " — allow this device to sync code in the web app under Settings → Devices"
      : result.status === 413
        ? " — too big for cloud sync; push it to a git remote such as GitHub instead"
        : ""
  return new Error(`${what} failed (${result.status}): ${JSON.stringify(result.body)}${hint}`)
}

async function listCloud(credentials: Credentials): Promise<Listed[]> {
  const result = await call<{ projects: Listed[] }>(credentials, "/api/code/pull")
  if (!result.ok) throw failure("listing cloud projects", result)
  return result.body.projects
}

/**
 * Brings the cloud's newer commits down and merges them. With `abortOnConflict` a
 * conflicted merge is undone instead of left in the files — for auto-sync, which runs
 * between turns where nobody asked for a merge to land in their working tree.
 */
export async function pullCloud(project: Project, options: { abortOnConflict?: boolean } = {}): Promise<string> {
  const credentials = requireCredentials()
  const since = cloudSha(project.dir)
  const query = `projectId=${encodeURIComponent(project.id)}${since ? `&since=${since}` : ""}`
  const result = await call<PullBody>(credentials, `/api/code/pull?${query}`)
  if (!result.ok && result.status === 404) return `${project.name} is not on the cloud yet — /code push ${project.name}`
  if (!result.ok) throw failure("pull", result)
  if (result.body.bundles.length === 0) return `${project.name} is up to date with the cloud (v${result.body.version})`

  if (headSha(project.dir)) commitAll(project.dir, "jarvis: save before pull")
  const { conflicts } = applyBundles(project.dir, result.body.bundles.map((entry) => entry.bundle))
  if (conflicts.length > 0 && options.abortOnConflict) {
    git(project.dir, ["merge", "--abort"])
    throw new Error(`${project.name} conflicts with the cloud in ${conflicts.join(", ")} — run /code pull ${project.name} to merge by hand`)
  }
  if (conflicts.length > 0) {
    return [
      `${project.name}: merged cloud v${result.body.version} with conflicts in:`,
      ...conflicts.map((path) => `  ${path}`),
      "Fix the conflict markers, then /code push to finish the merge.",
    ].join("\n")
  }
  return `${project.name} is now at cloud v${result.body.version} (${headSha(project.dir)?.slice(0, 7)})`
}

export async function pushCloud(project: Project, options: { message?: string; abortOnConflict?: boolean } = {}): Promise<string> {
  const credentials = requireCredentials()
  commitAll(project.dir, options.message ?? "jarvis: sync")

  const send = () => {
    const head = headSha(project.dir)!
    const base = cloudSha(project.dir)
    return {
      head,
      request: call<PushBody>(credentials, "/api/code/push", {
        method: "POST",
        idempotencyKey: `${project.id}:${head}`,
        body: JSON.stringify({
          projectId: project.id,
          name: project.name,
          baseSha: base ?? null,
          headSha: head,
          message: lastMessage(project.dir),
          bundle: bundleSince(project.dir, base),
          files: snapshot(project.dir).files,
        }),
      }),
    }
  }

  if (headSha(project.dir) === cloudSha(project.dir)) return `${project.name} is already on the cloud`
  let attempt = send()
  let result = await attempt.request
  let merged = false
  if (!result.ok && result.status === 409) {
    // Someone else pushed first. Merge their work in — a real git merge — and try once more.
    const pulled = await pullCloud(project, options)
    if (unmerged(project.dir).length > 0) return pulled
    merged = true
    if (headSha(project.dir) === cloudSha(project.dir)) return `${project.name} is already on the cloud`
    attempt = send()
    result = await attempt.request
  }
  if (!result.ok) throw failure("push", result)
  setCloudSha(project.dir, attempt.head)
  if (result.body.upToDate) return `${project.name} is already on the cloud`
  return `${merged ? "merged with the cloud and pushed" : "pushed"} ${project.name} — cloud v${result.body.version} (${attempt.head.slice(0, 7)})`
}

/** GitHub or any other remote. Credentials are the user's own git setup; JARVIS holds none. */
export async function pushRemote(project: Project, remote: string, message?: string): Promise<string> {
  if (!remotes(project.dir).includes(remote)) {
    throw new Error(`${project.name} has no git remote "${remote}" — \`git -C ${project.dir} remote add ${remote} <url>\``)
  }
  commitAll(project.dir, message ?? "jarvis: sync")
  await gitRemote(project.dir, ["push", "--quiet", "--set-upstream", remote, "HEAD"])
  return `pushed ${project.name} to ${remote}/${currentBranch(project.dir)}`
}

export async function pullRemote(project: Project, remote: string): Promise<string> {
  if (!remotes(project.dir).includes(remote)) throw new Error(`${project.name} has no git remote "${remote}"`)
  if (headSha(project.dir)) commitAll(project.dir, "jarvis: save before pull")
  try {
    await gitRemote(project.dir, ["pull", "--quiet", "--no-rebase", "--no-edit", remote, currentBranch(project.dir)])
  } catch (error) {
    const conflicts = unmerged(project.dir)
    if (conflicts.length === 0) throw error
    return [`${project.name}: merged ${remote} with conflicts in:`, ...conflicts.map((path) => `  ${path}`)].join("\n")
  }
  return `${project.name} is up to date with ${remote}/${currentBranch(project.dir)}`
}

export const push = (project: Project, target: Target = "cloud", message?: string) =>
  target === "cloud" ? pushCloud(project, { message }) : pushRemote(project, target, message)

export const pull = (project: Project, target: Target = "cloud") =>
  target === "cloud" ? pullCloud(project) : pullRemote(project, target)

/** A cloud project into `cwd/<name>`, as its own repo that already knows where it came from. */
export async function clone(cwd: string, name: string): Promise<string> {
  const credentials = requireCredentials()
  const wanted = safeName(name)
  const listed = (await listCloud(credentials)).find((project) => project.name === wanted || project.id === name)
  if (!listed) throw new Error(`no cloud project "${wanted}" on this workstation`)
  const dir = join(cwd, listed.name)
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} already exists and is not empty`)
  mkdirSync(dir, { recursive: true })
  git(dir, ["init", "--quiet", "--initial-branch=main"])
  git(dir, ["config", "jarvis.projectId", listed.id])
  git(dir, ["config", "jarvis.name", listed.name])
  const project = projectAt(dir)!
  await pullCloud(project)
  return `cloned ${listed.name} (cloud v${listed.version}) into ${dir}`
}

export async function list(cwd: string): Promise<string> {
  const local = findProjects(cwd)
  const credentials = readCredentials()
  const cloud = credentials ? await listCloud(credentials).catch(() => undefined) : undefined
  const lines = local.map((project) => {
    const remote = cloud?.find((entry) => entry.id === project.id)
    return `${project.name.padEnd(24)} ${project.dir}${remote ? `  cloud v${remote.version}` : ""}`
  })
  const elsewhere = (cloud ?? []).filter((entry) => !local.some((project) => project.id === entry.id))
  if (elsewhere.length > 0) {
    lines.push("", "on the cloud, not here (/code clone <name>):", ...elsewhere.map((entry) => `  ${entry.name}  v${entry.version}`))
  }
  if (lines.length === 0) return "no code projects — /code new <name> or `jarvis init` to make one"
  return lines.join("\n")
}

export async function status(project: Project): Promise<string> {
  const credentials = readCredentials()
  const dirty = git(project.dir, ["status", "--porcelain"]).out
  const head = headSha(project.dir)
  const cloud = credentials ? (await listCloud(credentials).catch(() => [])).find((entry) => entry.id === project.id) : undefined
  return [
    `${project.name}  ${project.dir}`,
    `local   ${head?.slice(0, 7) ?? "—"} on ${currentBranch(project.dir)}${dirty ? " (uncommitted changes)" : ""}`,
    credentials
      ? `cloud   ${cloud ? `v${cloud.version} ${cloud.headSha?.slice(0, 7) ?? ""}${cloud.headSha === head ? " — in sync" : ""}` : "not pushed yet"}`
      : "cloud   not paired — /pair to connect this device",
    `remotes ${remotes(project.dir).join(", ") || "none — `git remote add origin <url>` to add GitHub"}`,
  ].join("\n")
}

/**
 * After a turn: commit, then push wherever this project already syncs — the cloud when
 * paired, and `origin` when there is one. Only problems come back; a success every turn
 * would be noise.
 */
export async function autoSync(config: Config, cwd: string): Promise<string[]> {
  if (!config.code.autoSync) return []
  const problems: string[] = []
  const paired = readCredentials() !== undefined
  for (const project of findProjects(cwd)) {
    try {
      commitAll(project.dir, "jarvis: auto-sync")
      if (paired) await pushCloud(project, { abortOnConflict: true })
      if (remotes(project.dir).includes("origin")) await pushRemote(project, "origin")
    } catch (error) {
      problems.push(`auto-sync ${project.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return problems
}
