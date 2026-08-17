import { basename } from "node:path"
import { dynamicTool, jsonSchema } from "ai"
import { z } from "zod"
import { resourceFiles } from "../config/discover.ts"
import type { ToolContext } from "../tools/context.ts"
import type { ToolSet } from "../tools/index.ts"

/** What a `.jarvis/tools/*.ts` export has to look like. */
export type CustomToolDefinition = {
  description: string
  /** A Standard Schema, a JSON Schema object, or a record of either. */
  args?: unknown
  /** Alias for `args`, for anyone who prefers the AI SDK's own naming. */
  inputSchema?: unknown
  execute: (args: Record<string, unknown>, context: CustomToolContext) => unknown
}

export type CustomToolContext = {
  agent: string
  sessionID: string
  messageID: string
  /** Session working directory. */
  directory: string
  /** Git worktree root, or the directory when not in a repo. */
  worktree: string
  abort?: AbortSignal
}

export type CustomTools = { definitions: Record<string, CustomToolDefinition>; errors: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isStandardSchema = (value: unknown) => isRecord(value) && "~standard" in value

const isJsonSchema = (value: unknown) => isRecord(value) && typeof value.type === "string"

/**
 * Normalises the three shapes a tool file may declare its arguments in. A record of
 * schemas is opencode's style; a bare Standard Schema or raw JSON Schema both work
 * too, so a tool file needs no dependencies at all.
 */
export function toInputSchema(declared: unknown): unknown {
  if (declared === undefined) return jsonSchema({ type: "object", properties: {} })
  if (isStandardSchema(declared)) return declared
  if (isJsonSchema(declared)) return jsonSchema(declared as Parameters<typeof jsonSchema>[0])
  if (!isRecord(declared)) throw new Error("args must be a schema, a JSON Schema object, or a record of either")

  const entries = Object.entries(declared)
  if (entries.every(([, value]) => isJsonSchema(value))) {
    return jsonSchema({
      type: "object",
      properties: Object.fromEntries(entries) as Record<string, unknown>,
      required: entries.filter(([, value]) => !(value as { optional?: boolean }).optional).map(([key]) => key),
      additionalProperties: false,
    } as Parameters<typeof jsonSchema>[0])
  }
  // ponytail: wrapping a record of foreign zod schemas relies on zod v4's internal
  // shape being stable across copies. Fine in practice; the catch tells the user to
  // use a single `z.object({...})` if their zod is too old or too new.
  try {
    return z.object(declared as Parameters<typeof z.object>[0])
  } catch (error) {
    throw new Error(
      `could not read args (${error instanceof Error ? error.message : String(error)}) — pass a single z.object({...}) as inputSchema instead`,
    )
  }
}

function isDefinition(value: unknown): value is CustomToolDefinition {
  return isRecord(value) && typeof value.description === "string" && typeof value.execute === "function"
}

/** `foo.ts` default export becomes `foo`; named export `bar` becomes `foo_bar`. */
export function toolNameFor(file: string, exportName: string): string {
  const stem = basename(file).replace(/\.[cm]?tsx?$/, "")
  return exportName === "default" ? stem : `${stem}_${exportName}`
}

function wrap(name: string, definition: CustomToolDefinition, ctx: ToolContext) {
  return dynamicTool({
    description: definition.description,
    inputSchema: toInputSchema(definition.inputSchema ?? definition.args) as never,
    execute: async (input, options) => {
      await ctx.gate.check({ tool: name, title: `run ${name}`, detail: JSON.stringify(input, null, 2), subject: name })
      const result = await definition.execute((input ?? {}) as Record<string, unknown>, {
        agent: ctx.agent,
        sessionID: ctx.sessionID,
        messageID: options.toolCallId,
        directory: ctx.cwd,
        worktree: ctx.worktree,
        abort: options.abortSignal,
      })
      return typeof result === "string" ? result : JSON.stringify(result, null, 2)
    },
  })
}

/**
 * Imports every tool declared in `.jarvis/tools/*.ts`, once, at startup. A file that
 * fails to import or declares something unusable is reported and skipped — never
 * fatal, the same policy failing MCP servers get.
 */
export async function loadCustomTools(cwd: string): Promise<CustomTools> {
  const definitions: Record<string, CustomToolDefinition> = {}
  const errors: string[] = []

  for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
    for (const path of resourceFiles(cwd, "tools", extension)) {
      let module: Record<string, unknown>
      try {
        module = (await import(path)) as Record<string, unknown>
      } catch (error) {
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      for (const [exportName, value] of Object.entries(module)) {
        if (!isDefinition(value)) continue
        try {
          toInputSchema(value.inputSchema ?? value.args) // validate now, not mid-conversation
        } catch (error) {
          errors.push(`${path} (${exportName}): ${error instanceof Error ? error.message : String(error)}`)
          continue
        }
        definitions[toolNameFor(path, exportName)] = value
      }
    }
  }
  return { definitions, errors }
}

/** Turns loaded definitions into callable tools for one run. */
export function customTools(definitions: Record<string, CustomToolDefinition>, ctx: ToolContext): ToolSet {
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, wrap(name, definition, ctx)]))
}
