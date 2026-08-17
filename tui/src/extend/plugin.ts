import type { ModelMessage } from "ai"
import type { Config, Permission } from "../config/config.ts"
import { resourceFiles } from "../config/discover.ts"
import type { PermissionRequest } from "../permission.ts"
import type { CustomToolDefinition } from "./custom-tools.ts"
import type { ToolSet } from "../tools/index.ts"

/**
 * Hooks a `.jarvis/plugins/*.ts` file may return. Each one exists because jarvis
 * already has a single seam for it, so a plugin cannot end up half-applied.
 */
export type PluginHooks = {
  /** Before a tool runs. Mutate `output.args`, or throw to refuse the call. */
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; agent: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void> | void
  /** After a tool runs. Mutate `output.output` to rewrite what the model sees. */
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; agent: string },
    output: { output: string },
  ) => Promise<void> | void
  /** Before the permission gate prompts. Set `output.status` to decide it silently. */
  "permission.ask"?: (
    input: PermissionRequest,
    output: { status?: Permission },
  ) => Promise<void> | void
  /** Before a turn is sent. Mutate `output.messages` to rewrite the conversation. */
  "chat.message"?: (
    input: { agent: string; model: string; sessionID: string },
    output: { messages: ModelMessage[] },
  ) => Promise<void> | void
  /** Every agent event, for observation. */
  event?: (input: { event: unknown }) => Promise<void> | void
  /** Extra tools contributed programmatically, merged last. */
  tool?: Record<string, CustomToolDefinition>
}

export type PluginInput = {
  directory: string
  worktree: string
  config: Config
  /** Bun's shell, so plugins can run commands without importing anything. */
  $: typeof Bun.$
}

export type PluginFactory = (input: PluginInput) => Promise<PluginHooks> | PluginHooks

export type Plugins = {
  hooks: PluginHooks[]
  /** Tools contributed by `tool` hooks, keyed by name. */
  tools: Record<string, CustomToolDefinition>
  errors: string[]
}

export const NO_PLUGINS: Plugins = { hooks: [], tools: {}, errors: [] }

/**
 * Imports every plugin file and calls each exported function once. A plugin that
 * throws is reported and skipped rather than taking the session down with it.
 */
export async function loadPlugins(cwd: string, config: Config, worktree: string): Promise<Plugins> {
  const hooks: PluginHooks[] = []
  const tools: Record<string, CustomToolDefinition> = {}
  const errors: string[] = []
  const input: PluginInput = { directory: cwd, worktree, config, $: Bun.$ }

  for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
    for (const path of resourceFiles(cwd, "plugins", extension)) {
      let module: Record<string, unknown>
      try {
        module = (await import(path)) as Record<string, unknown>
      } catch (error) {
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      for (const [name, value] of Object.entries(module)) {
        if (typeof value !== "function") continue
        try {
          const result = await (value as PluginFactory)(input)
          if (!result || typeof result !== "object") continue
          hooks.push(result)
          Object.assign(tools, result.tool ?? {})
        } catch (error) {
          errors.push(`${path} (${name}): ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }
  return { hooks, tools, errors }
}

/** The callable hooks, with `undefined` stripped, so `fire` can infer their arguments. */
type CallableHooks = {
  [K in keyof PluginHooks as NonNullable<PluginHooks[K]> extends (...args: never[]) => unknown
    ? K
    : never]-?: NonNullable<PluginHooks[K]>
}

/** Runs one hook across every plugin, in load order. */
export async function fire<K extends keyof CallableHooks>(
  plugins: Plugins,
  hook: K,
  ...args: Parameters<CallableHooks[K]>
): Promise<void> {
  for (const set of plugins.hooks) {
    const handler = set[hook]
    if (typeof handler === "function") await (handler as (...a: unknown[]) => unknown)(...args)
  }
}

/**
 * Applies the execute hooks to every tool at once — built-in, custom and MCP alike —
 * so plugins see the whole tool surface from one place.
 */
export function wrapTools(tools: ToolSet, plugins: Plugins, meta: { sessionID: string; agent: string }): ToolSet {
  if (plugins.hooks.length === 0) return tools
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute
      if (typeof execute !== "function") return [name, definition]
      return [
        name,
        {
          ...definition,
          execute: async (input: unknown, options: unknown) => {
            const before = { args: (input ?? {}) as Record<string, unknown> }
            await fire(plugins, "tool.execute.before", { tool: name, ...meta }, before)
            const result = await (execute as (i: unknown, o: unknown) => unknown)(before.args, options)
            const after = { output: typeof result === "string" ? result : JSON.stringify(result, null, 2) }
            await fire(plugins, "tool.execute.after", { tool: name, ...meta }, after)
            return after.output
          },
        },
      ]
    }),
  )
}
