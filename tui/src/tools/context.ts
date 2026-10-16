import { lstatSync, realpathSync } from "node:fs"
import { stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { PermissionGate } from "../permission.ts"

export class ToolError extends Error {}

/** Truncates tool output so one runaway command cannot fill the context window. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…(${text.length - max} more bytes)` : text
}

export type ToolContext = {
  /** Workspace root. Tools cannot touch anything outside it. */
  cwd: string
  /** Glob -> commands to run after a file matching it is written. */
  check?: Record<string, string[]>
  /** `config.vision`, for `find_item`'s match threshold. */
  vision?: { threshold?: number }
  /** Git worktree root, or `cwd` when not in a repo. Passed to custom tools. */
  worktree: string
  /**
   * Root of the blueprint store — its own git repo, outside the workspace. Deliberately
   * separate from `cwd`, so blueprint tools clamp names with `safeName` instead of
   * `resolvePath`.
   */
  blueprints: string
  gate: PermissionGate
  /**
   * Absolute path to the mtime it had when read, for the whole session. `edit` requires
   * an entry, and a changed mtime means someone edited the file behind the agent's back.
   */
  read: Map<string, number>
  /** How deep in the subagent tree we are; the `task` tool refuses to go past 1. */
  depth: number
  /** Name of the agent running this turn. */
  agent: string
  sessionID: string
  /** Runs a subagent and resolves with its final text. Absent for leaf agents. */
  spawn?: (agent: string, prompt: string) => Promise<string>
  /**
   * Puts a multiple-choice question to the person at the keyboard and resolves with what
   * they picked, or `""` if they dismissed it. Absent when nobody is watching — headless
   * runs, cron jobs — which is what removes the `ask` tool from the set entirely, so the
   * model never offers to consult a user who is not there.
   */
  ask?: (question: string, options: string[]) => Promise<string>
  /**
   * Opens the live camera screen with taught items outlined, on `item` or all of them. Absent
   * when nobody is watching, like `ask`; `find_item` answers in text either way.
   */
  showItems?: (item?: string) => void
}

/**
 * `path` with every symlink resolved. A path that doesn't exist yet (a file about to be
 * written) resolves through its nearest existing ancestor.
 */
function realPath(path: string): string {
  const missing: string[] = []
  let dir = path
  while (!lstatSync(dir, { throwIfNoEntry: false })) {
    const parent = dirname(dir)
    if (parent === dir) break
    missing.unshift(basename(dir))
    dir = parent
  }
  try {
    return join(realpathSync(dir), ...missing)
  } catch {
    throw new ToolError(`cannot resolve ${path} (a dangling symlink?)`)
  }
}

/**
 * Resolves a tool-supplied path against the workspace and refuses to escape it. Compared
 * after resolving symlinks, so a link in the repo (`docs -> ~/.ssh`) is no way out.
 */
export function resolvePath(ctx: ToolContext, path: string): string {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(ctx.cwd, path)
  const rel = relative(realPath(ctx.cwd), realPath(absolute))
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ToolError(`path is outside the workspace: ${path}`)
  }
  return absolute
}

/** Records a file as read at its current mtime, so `edit` can tell if it changes later. */
export async function markRead(ctx: ToolContext, absolute: string): Promise<void> {
  ctx.read.set(absolute, (await stat(absolute)).mtimeMs)
}

/** Workspace-relative display form, used in permission prompts and tool output. */
export function displayPath(ctx: ToolContext, absolute: string): string {
  return relative(ctx.cwd, absolute) || "."
}
