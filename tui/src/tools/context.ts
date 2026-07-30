import { isAbsolute, relative, resolve } from "node:path"
import type { PermissionGate } from "../permission.ts"

export class ToolError extends Error {}

export type ToolContext = {
  /** Workspace root. Tools cannot touch anything outside it. */
  cwd: string
  /** Git worktree root, or `cwd` when not in a repo. Passed to custom tools. */
  worktree: string
  gate: PermissionGate
  /** Absolute paths read this turn, so `edit`/`write` can require a prior read. */
  read: Set<string>
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

/** Workspace-relative display form, used in permission prompts and tool output. */
export function displayPath(ctx: ToolContext, absolute: string): string {
  return relative(ctx.cwd, absolute) || "."
}
