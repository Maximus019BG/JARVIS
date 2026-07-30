import { stat } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
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
  /** Git worktree root, or `cwd` when not in a repo. Passed to custom tools. */
  worktree: string
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
}

/** Resolves a tool-supplied path against the workspace and refuses to escape it. */
export function resolvePath(ctx: ToolContext, path: string): string {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(ctx.cwd, path)
  const rel = relative(ctx.cwd, absolute)
  if (rel.startsWith("..")) throw new ToolError(`path is outside the workspace: ${path}`)
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
