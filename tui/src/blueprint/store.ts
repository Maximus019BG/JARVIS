// The only file here that touches the filesystem or spawns anything. Everything else in
// this directory is pure so the web app and the Pi can import it; keep it that way.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Config } from "../config/config.ts"
import { dataDir } from "../config/paths.ts"
import { BlueprintError, emptyDoc, parseDoc, serialize, type BlueprintDoc } from "./schema.ts"

const SUFFIX = ".blueprint.json"

/**
 * Blueprint names become filenames in a directory the workspace sandbox does not cover —
 * these tools deliberately do not go through `resolvePath`, which clamps to the session
 * cwd. So this is the whole path-traversal defence, and it is a whitelist rather than a
 * blacklist for that reason.
 */
const VALID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function safeName(name: string): string {
  const trimmed = name.trim().replace(new RegExp(`${SUFFIX.replace(".", "\\.")}$`), "")
  if (VALID.test(trimmed)) return trimmed
  // Correct the name rather than refuse it. There is exactly one right answer — the usual
  // failure is an underscore or a capital — and a caller told to try again mostly tries a
  // different wrong name instead. Idempotent, so a name that came back from here round-trips
  // through `sync` and the Pi unchanged.
  //
  // Not for anything path-shaped, though. `../../etc/passwd` would normalize to a perfectly
  // safe `etc-passwd`, and quietly drawing into that is worse than refusing: the caller is
  // confused about what a blueprint name is, and this is the one place that shows up.
  if (/[/\\]/.test(trimmed) || trimmed.includes("..")) {
    throw new BlueprintError(`invalid blueprint name "${name}": a blueprint name is not a path`)
  }
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "")
  if (VALID.test(normalized)) return normalized
  throw new BlueprintError(
    `invalid blueprint name "${name}": use lowercase letters, digits and hyphens, starting with a letter or digit, up to 64 characters`,
  )
}

export function blueprintRoot(config: Config): string {
  return config.blueprint.dir ?? join(dataDir, "blueprints", config.blueprint.workspace)
}

const filePath = (root: string, name: string) => join(root, `${safeName(name)}${SUFFIX}`)

type GitResult = { ok: boolean; out: string; err: string }

function git(root: string, args: string[]): GitResult {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
  return { ok: result.exitCode === 0, out: result.stdout.toString().trim(), err: result.stderr.toString().trim() }
}

function gitOrThrow(root: string, args: string[]): string {
  const result = git(root, args)
  if (!result.ok) throw new BlueprintError(`git ${args[0]} failed: ${result.err || result.out}`)
  return result.out
}

/**
 * Creates the store on first use. `user.name`/`user.email` are set locally because a Pi
 * fresh out of the box has no global git identity and every commit would fail.
 */
export function ensureRepo(root: string): void {
  if (existsSync(join(root, ".git"))) return
  mkdirSync(root, { recursive: true })
  gitOrThrow(root, ["init", "--quiet", "--initial-branch=main"])
  git(root, ["config", "user.name", "jarvis"])
  git(root, ["config", "user.email", "jarvis@localhost"])
}

export type BlueprintSummary = {
  name: string
  entities: number
  layers: number
  head?: string
  updated?: string
  message?: string
}

export function listBlueprints(root: string): BlueprintSummary[] {
  if (!existsSync(root)) return []
  const names = [...new Bun.Glob(`*${SUFFIX}`).scanSync({ cwd: root, onlyFiles: true })]
    .map((file) => file.slice(0, -SUFFIX.length))
    .sort()

  return names.map((name) => {
    let entities = 0
    let layers = 0
    try {
      const doc = readDoc(root, name)
      entities = doc.entities.length
      layers = doc.layers.length
    } catch {
      // A file that will not parse still belongs in the listing — that is how the user
      // finds out it is broken instead of wondering where it went.
    }
    const log = git(root, ["log", "-1", "--format=%h%x00%cr%x00%s", "--", `${name}${SUFFIX}`])
    const [head, updated, message] = log.ok && log.out ? log.out.split("\0") : []
    return { name, entities, layers, head, updated, message }
  })
}

export function exists(root: string, name: string): boolean {
  return existsSync(filePath(root, name))
}

/**
 * "It is not there" on its own leaves a caller with nowhere to go, and an agent that has
 * just guessed a name will guess again. Say how to create one and what already exists.
 * A bare readdir rather than `listBlueprints`, which spawns git per entry — this is an
 * error path and does not need the history.
 */
function noSuchBlueprint(root: string, name: string): BlueprintError {
  const found = existsSync(root)
    ? [...new Bun.Glob(`*${SUFFIX}`).scanSync({ cwd: root, onlyFiles: true })].map((file) => file.slice(0, -SUFFIX.length)).sort()
    : []
  const existing = found.length > 0 ? `, or use an existing one: ${found.slice(0, 20).join(", ")}` : ""
  return new BlueprintError(
    `no blueprint named "${safeName(name)}" — create it first with blueprint action:"create"${existing}`,
  )
}

export function readDoc(root: string, name: string): BlueprintDoc {
  const path = filePath(root, name)
  if (!existsSync(path)) throw noSuchBlueprint(root, name)
  try {
    return parseDoc(readFileSync(path, "utf8"))
  } catch (error) {
    if (error instanceof BlueprintError) throw new BlueprintError(`${safeName(name)}: ${error.message}`)
    throw error
  }
}

/**
 * Read, or hand back a fresh empty document. Every writing path wants this: making a caller
 * `create` before it can draw is a two-call handshake, and a model that fumbles the first
 * call is left with an edit that can never land. Reading paths keep `readDoc`, where "it is
 * not there" is the honest answer.
 */
export function readOrCreate(root: string, name: string): BlueprintDoc {
  const safe = safeName(name)
  return exists(root, safe) ? readDoc(root, safe) : emptyDoc(safe)
}

export function writeDoc(root: string, name: string, doc: BlueprintDoc, message: string): string {
  ensureRepo(root)
  const file = `${safeName(name)}${SUFFIX}`
  writeFileSync(join(root, file), serialize(doc))
  gitOrThrow(root, ["add", "--", file])

  // Nothing staged means the ops were a no-op — an empty commit would add a version with
  // no change behind it, which makes the history lie.
  if (git(root, ["diff", "--cached", "--quiet", "--", file]).ok) {
    return git(root, ["rev-parse", "--short", "HEAD"]).out || "unchanged"
  }
  gitOrThrow(root, ["commit", "--quiet", "-m", `${safeName(name)}: ${message}`, "--", file])
  return gitOrThrow(root, ["rev-parse", "--short", "HEAD"])
}

export function deleteDoc(root: string, name: string): void {
  const file = `${safeName(name)}${SUFFIX}`
  if (!existsSync(join(root, file))) throw noSuchBlueprint(root, name)
  gitOrThrow(root, ["rm", "--quiet", "--", file])
  gitOrThrow(root, ["commit", "--quiet", "-m", `${safeName(name)}: delete`, "--", file])
}

export type Commit = {
  sha: string
  message: string
  /** ISO 8601. What gets pushed — a relative string is not a timestamp. */
  at: string
  /** git's own "3 minutes ago" phrasing, for display only. */
  relative: string
  author: string
}

export function history(root: string, name: string, limit = 20): Commit[] {
  if (!existsSync(join(root, ".git"))) return []
  const file = `${safeName(name)}${SUFFIX}`
  const log = git(root, ["log", `-${limit}`, "--format=%h%x00%s%x00%cI%x00%cr%x00%an", "--", file])
  if (!log.ok || !log.out) return []
  return log.out.split("\n").map((row) => {
    const [sha, message, at, relative, author] = row.split("\0")
    return {
      sha: sha ?? "",
      message: message ?? "",
      at: at ?? "",
      relative: relative ?? "",
      author: author ?? "",
    }
  })
}

/** The document as it was at a commit, for `blueprint_view … at:<sha>`. */
export function docAt(root: string, name: string, sha: string): BlueprintDoc {
  const file = `${safeName(name)}${SUFFIX}`
  const shown = git(root, ["show", `${sha}:${file}`])
  if (!shown.ok) throw new BlueprintError(`cannot read ${safeName(name)} at ${sha}: ${shown.err}`)
  return parseDoc(shown.out)
}
