import type { Tool } from "ai"
import { bashTool } from "./bash.ts"
import { editTool } from "./edit.ts"
import { globTool } from "./glob.ts"
import { grepTool } from "./grep.ts"
import { listTool } from "./list.ts"
import { readTool } from "./read.ts"
import { taskTool } from "./task.ts"
import { writeTool } from "./write.ts"
import type { ToolContext } from "./context.ts"

export { ToolError, type ToolContext, displayPath, resolvePath } from "./context.ts"
export { MAX_DEPTH } from "./task.ts"

export type ToolSet = Record<string, Tool>

/** The built-in tools. `task` is only present when the context can spawn subagents. */
export function builtinTools(ctx: ToolContext, agents: { name: string; description: string }[] = []): ToolSet {
  const tools: ToolSet = {
    read: readTool(ctx),
    write: writeTool(ctx),
    edit: editTool(ctx),
    bash: bashTool(ctx),
    glob: globTool(ctx),
    grep: grepTool(ctx),
    list: listTool(ctx),
  }
  if (ctx.spawn && agents.length > 0) tools.task = taskTool(ctx, agents)
  return tools
}

/**
 * Applies an agent's tool policy: explicit `true`/`false` entries win, everything
 * else follows `defaultTools`. Supports a trailing `*` for prefix matches.
 */
export function filterTools(tools: ToolSet, policy: Record<string, boolean>, fallback: boolean): ToolSet {
  const decide = (name: string): boolean => {
    if (name in policy) return policy[name]!
    for (const [pattern, enabled] of Object.entries(policy)) {
      if (pattern.endsWith("*") && name.startsWith(pattern.slice(0, -1))) return enabled
    }
    return fallback
  }
  return Object.fromEntries(Object.entries(tools).filter(([name]) => decide(name)))
}
