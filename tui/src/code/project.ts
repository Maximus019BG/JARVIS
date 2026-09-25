// Bun-only. A code project is an ordinary git repo inside the workspace — not a store in
// the data dir like blueprints — because the agent's file tools are clamped to `cwd` and a
// project the agent cannot edit is not much of a project.
//
// Identity lives in the repo's own git config (`jarvis.projectId`, `jarvis.name`), and the
// last commit the cloud and this repo agreed on is the ref `refs/jarvis/cloud`, so nothing
// JARVIS-specific is ever committed into the user's code.
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { git, gitOrThrow, safeName } from "../blueprint/store.ts"

export const CLOUD_REF = "refs/jarvis/cloud"

export type Project = { dir: string; id: string; name: string }

const MAX_FILE = 256 * 1024
const MAX_SNAPSHOT = 2 * 1024 * 1024

const configValue = (dir: string, key: string) => {
  const result = git(dir, ["config", "--local", "--get", key])
  return result.ok && result.out ? result.out : undefined
}

const real = (path: string) => realpathSync(path)

/** Toplevel of the repo `dir` is in, or undefined outside any repo. */
function toplevel(dir: string): string | undefined {
  const result = git(dir, ["rev-parse", "--show-toplevel"])
  return result.ok ? real(result.out) : undefined
}

/** A fresh Pi has no global git identity and every commit would fail without this. */
function ensureIdentity(dir: string): void {
  if (!git(dir, ["config", "user.email"]).ok) git(dir, ["config", "user.email", "jarvis@localhost"])
  if (!git(dir, ["config", "user.name"]).ok) git(dir, ["config", "user.name", "jarvis"])
}

export function projectAt(dir: string): Project | undefined {
  if (!existsSync(dir)) return undefined
  const top = toplevel(dir)
  if (!top) return undefined
  const id = configValue(top, "jarvis.projectId")
  if (!id) return undefined
  return { dir: top, id, name: configValue(top, "jarvis.name") ?? safeName(basename(top)) }
}

/**
 * Marks `dir` as a project. Inside an existing repo that repo becomes the project — `jarvis
 * init` in a subfolder must not nest a second `.git` — otherwise a new repo is created.
 * Idempotent: an existing project keeps its id.
 */
export function initProject(dir: string, name?: string): Project {
  mkdirSync(dir, { recursive: true })
  const existing = projectAt(dir)
  if (existing) return existing
  let top = toplevel(dir)
  if (!top) {
    gitOrThrow(dir, ["init", "--quiet", "--initial-branch=main"])
    top = real(dir)
  }
  ensureIdentity(top)
  const safe = safeName(name ?? basename(top))
  gitOrThrow(top, ["config", "jarvis.projectId", randomUUID()])
  gitOrThrow(top, ["config", "jarvis.name", safe])
  return projectAt(top)!
}

/** `cwd/<name>`, always its own repo, with a first commit so there is something to push. */
export function createProject(cwd: string, name: string): Project {
  const safe = safeName(name)
  const dir = join(cwd, safe)
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} already exists and is not empty`)
  mkdirSync(dir, { recursive: true })
  gitOrThrow(dir, ["init", "--quiet", "--initial-branch=main"])
  const project = initProject(dir, safe)
  writeFileSync(join(dir, "README.md"), `# ${safe}\n`)
  commitAll(dir, `create ${safe}`)
  return project
}

/** The workspace itself and any direct child that is its own repo. */
export function findProjects(cwd: string): Project[] {
  const candidates = [cwd]
  for (const entry of readdirSync(cwd, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(cwd, entry.name, ".git"))) candidates.push(join(cwd, entry.name))
  }
  const seen = new Map<string, Project>()
  for (const dir of candidates) {
    const project = projectAt(dir)
    if (project) seen.set(project.dir, project)
  }
  return [...seen.values()]
}

/** By name, or the only project there is. */
export function resolveProject(cwd: string, name?: string): Project {
  const projects = findProjects(cwd)
  if (name) {
    const safe = safeName(name)
    const found = projects.find((project) => project.name === safe)
    if (!found) throw new Error(`no code project "${safe}" here — /code new ${safe} or \`jarvis init\` to make one`)
    return found
  }
  if (projects.length === 1) return projects[0]!
  if (projects.length === 0) throw new Error("no code project here — /code new <name> or `jarvis init` to make one")
  throw new Error(`which project? ${projects.map((project) => project.name).join(", ")}`)
}

export const headSha = (dir: string) => {
  const result = git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"])
  return result.ok ? result.out : undefined
}

export const cloudSha = (dir: string) => {
  const result = git(dir, ["rev-parse", "--verify", "--quiet", CLOUD_REF])
  return result.ok ? result.out : undefined
}

export const setCloudSha = (dir: string, sha: string) => gitOrThrow(dir, ["update-ref", CLOUD_REF, sha])

export const lastMessage = (dir: string) => git(dir, ["log", "-1", "--format=%s"]).out

export const currentBranch = (dir: string) => git(dir, ["branch", "--show-current"]).out || "main"

export const remotes = (dir: string) => git(dir, ["remote"]).out.split("\n").filter(Boolean)

export const unmerged = (dir: string) =>
  git(dir, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean)

/**
 * Commits everything, if anything changed. Refuses while conflict markers are still in a
 * file — `add -A` would happily commit them — but a file that was unmerged and has since
 * been fixed by hand is fine, and committing is exactly how that merge gets concluded.
 */
export function commitAll(dir: string, message: string): boolean {
  const marked = unmerged(dir).filter(
    (path) => existsSync(join(dir, path)) && /^(<{7}|>{7}) /m.test(readFileSync(join(dir, path), "utf8")),
  )
  if (marked.length > 0) throw new Error(`resolve the conflicts first: ${marked.join(", ")}`)
  ensureIdentity(dir)
  gitOrThrow(dir, ["add", "-A"])
  if (git(dir, ["diff", "--cached", "--quiet"]).ok && headSha(dir)) return false
  gitOrThrow(dir, ["commit", "--quiet", "--allow-empty", "-m", message])
  return true
}

/**
 * Tracked text files for the web viewer. Binaries and big files are left out rather than
 * refused: the bundle still carries them, the browser just cannot show them.
 */
export function snapshot(dir: string): { files: Record<string, string>; skipped: number } {
  const files: Record<string, string> = {}
  let total = 0
  let skipped = 0
  for (const path of gitOrThrow(dir, ["ls-files"]).split("\n").filter(Boolean)) {
    const absolute = join(dir, path)
    const size = existsSync(absolute) ? statSync(absolute).size : Infinity
    if (size > MAX_FILE || total + size > MAX_SNAPSHOT) {
      skipped += 1
      continue
    }
    const bytes = readFileSync(absolute)
    if (bytes.subarray(0, 8000).includes(0)) {
      skipped += 1
      continue
    }
    files[path] = bytes.toString("utf8")
    total += size
  }
  return { files, skipped }
}

function withTemp<T>(run: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-bundle-"))
  try {
    return run(join(dir, "b.bundle"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Commits after `base` (everything when there is none), base64 for a JSON body. */
export function bundleSince(dir: string, base: string | undefined): string {
  return withTemp((file) => {
    gitOrThrow(dir, ["bundle", "create", "--quiet", file, base ? `${base}..HEAD` : "HEAD"])
    return readFileSync(file).toString("base64")
  })
}

/**
 * Fetches the cloud's bundles in order into `CLOUD_REF` and merges it. A plain `git merge`
 * with `CLOUD_REF`'s old position as the natural merge base — so divergence gets a real
 * three-way merge, and conflicts are left in the files for a human, never guessed at.
 */
export function applyBundles(dir: string, bundles: string[]): { conflicts: string[] } {
  for (const bundle of bundles) {
    withTemp((file) => {
      writeFileSync(file, Buffer.from(bundle, "base64"))
      gitOrThrow(dir, ["fetch", "--quiet", file, `+HEAD:${CLOUD_REF}`])
    })
  }
  if (!headSha(dir)) {
    // Fresh clone: nothing to merge into.
    gitOrThrow(dir, ["reset", "--quiet", "--hard", CLOUD_REF])
    return { conflicts: [] }
  }
  ensureIdentity(dir)
  const merged = git(dir, ["merge", "--quiet", "--no-edit", CLOUD_REF])
  if (merged.ok) return { conflicts: [] }
  const conflicts = unmerged(dir)
  if (conflicts.length === 0) throw new Error(`git merge failed: ${merged.err || merged.out}`)
  return { conflicts }
}

/**
 * Pushes and pulls against a remote the user set up themselves — GitHub or anything else —
 * with their own credentials. Async because it goes over the network, and `spawnSync` would
 * freeze the TUI for the whole round trip. Prompts are switched off: there is no terminal
 * for git to ask a password on, and a hung child is worse than an error.
 */
export async function gitRemote(dir: string, args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
    },
  })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${(err || out).trim()}`)
  return (out || err).trim()
}
