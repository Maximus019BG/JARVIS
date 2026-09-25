import { asSchema, jsonSchema, type JSONSchema7, type Tool } from "ai"
import { blueprintTools } from "../blueprint/tools.ts"
import { codeProjectTool } from "../code/tools.ts"
import { MCP_PREFIX } from "../extend/mcp.ts"
import type { PermissionGate } from "../permission.ts"
import { askTool } from "./ask.ts"
import { bashOutputTool } from "./background.ts"
import { bashTool } from "./bash.ts"
import { calcTool } from "./calc.ts"
import { editTool } from "./edit.ts"
import { globTool } from "./glob.ts"
import { grepTool } from "./grep.ts"
import { listTool } from "./list.ts"
import { readTool } from "./read.ts"
import { taskTool } from "./task.ts"
import { todoTool } from "./todo.ts"
import { webfetchTool } from "./webfetch.ts"
import { writeTool } from "./write.ts"
import type { ToolContext } from "./context.ts"

export { ToolError, type ToolContext, displayPath, resolvePath } from "./context.ts"
export { MAX_DEPTH } from "./task.ts"

export type ToolSet = Record<string, Tool>

/**
 * The built-in tools. `task` is only present when the context can spawn subagents, and
 * `ask` only when there is a user to answer it — a headless run must not be offered a
 * tool that would block forever.
 */
export function builtinTools(ctx: ToolContext, agents: { name: string; description: string }[] = []): ToolSet {
  const tools: ToolSet = {
    read: readTool(ctx),
    write: writeTool(ctx),
    edit: editTool(ctx),
    bash: bashTool(ctx),
    glob: globTool(ctx),
    grep: grepTool(ctx),
    list: listTool(ctx),
    todo: todoTool(ctx),
    webfetch: webfetchTool(ctx),
    bash_output: bashOutputTool(ctx),
    engineering_calc: calcTool(ctx),
    ...blueprintTools(ctx, ctx.blueprints),
    code_project: codeProjectTool(ctx),
  }
  if (ctx.ask) tools.ask = askTool(ctx)
  if (ctx.spawn && agents.length > 0) tools.task = taskTool(ctx, agents)
  return tools
}

/**
 * Wraps every tool that does not already gate itself in a permission check, so an MCP
 * server's `delete_repo` cannot run unprompted. MCP tools report as tool `mcp` with the
 * bare tool name as the subject, which the existing prefix matcher turns into usable
 * rules for free: `"mcp": "ask"`, `"mcp:github_": "allow"`, `"mcp:github_delete": "deny"`.
 */
export function gateTools(tools: ToolSet, gate: PermissionGate, exempt: Set<string>): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute
      if (exempt.has(name) || typeof execute !== "function") return [name, definition]
      const mcp = name.startsWith(MCP_PREFIX)
      return [
        name,
        {
          ...definition,
          execute: async (input: unknown, options: unknown) => {
            await gate.check({
              tool: mcp ? "mcp" : name,
              title: `run ${name}`,
              detail: JSON.stringify(input, null, 2),
              subject: mcp ? name.slice(MCP_PREFIX.length) : name,
            })
            return (execute as (i: unknown, o: unknown) => unknown)(input, options)
          },
        },
      ]
    }),
  )
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

/**
 * Rewrites draft-07 tuples (`items: [a, b]`) as `items: a` plus a fixed length. vLLM checks
 * tool schemas against 2020-12, where an `items` array is invalid and fails the whole
 * request — and every blueprint point and viewBox is a tuple. Zod still validates the exact
 * tuple on the way in, so the model loses a little precision and nothing else.
 */
export function portableSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(portableSchema)
  if (!node || typeof node !== "object") return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) out[key] = portableSchema(value)
  if (Array.isArray(out.items)) {
    const items = out.items as unknown[]
    const unique = [...new Map(items.map((item) => [JSON.stringify(item), item])).values()]
    out.items = unique.length === 1 ? unique[0] : { anyOf: unique }
    out.minItems = items.length
    out.maxItems = items.length
    delete out.additionalItems
  }
  return out
}

export function portableSchemas(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      if (!definition.inputSchema) return [name, definition]
      const schema = asSchema(definition.inputSchema)
      return [
        name,
        {
          ...definition,
          inputSchema: jsonSchema(async () => portableSchema(await schema.jsonSchema) as JSONSchema7, {
            validate: schema.validate,
          }),
        },
      ]
    }),
  )
}
