import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { z } from "zod"
import { ancestors } from "./discover.ts"
import { configDir, configNames } from "./paths.ts"

export const PermissionSchema = z.enum(["ask", "allow", "deny"])

export const ModelConfigSchema = z
  .object({
    name: z.string().optional(),
    /** Provider-specific per-request options, merged into providerOptions. */
    options: z.record(z.string(), z.unknown()).optional(),
    reasoning: z.boolean().optional(),
    contextLimit: z.number().optional(),
    outputLimit: z.number().optional(),
    cost: z
      .object({ input: z.number(), output: z.number() })
      .optional()
      .describe("USD per million tokens, used for the status line estimate"),
  })
  .strict()

export const ProviderConfigSchema = z
  .object({
    name: z.string().optional(),
    /** npm package exporting an AI SDK provider factory, e.g. "@ai-sdk/anthropic". */
    npm: z.string(),
    /** Named export to use as the factory. Defaults to a sensible guess. */
    export: z.string().optional(),
    /** Passed to the provider factory (apiKey, baseURL, headers, ...). */
    options: z.record(z.string(), z.unknown()).default({}),
    models: z.record(z.string(), ModelConfigSchema).default({}),
    enabled: z.boolean().default(true),
  })
  .strict()

export const AgentConfigSchema = z
  .object({
    description: z.string().optional(),
    model: z.string().optional(),
    prompt: z.string().optional(),
    /** Path to a markdown file used as the system prompt. */
    promptFile: z.string().optional(),
    temperature: z.number().optional(),
    /** Tool name -> enabled. Unlisted tools follow `defaultTools`. */
    tools: z.record(z.string(), z.boolean()).default({}),
    defaultTools: z.boolean().default(true),
    permission: z.record(z.string(), PermissionSchema).default({}),
    /** Available via the `task` tool to other agents. */
    spawnable: z.boolean().default(true),
    enabled: z.boolean().default(true),
  })
  .strict()

export const McpConfigSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("local"),
      command: z.array(z.string()).nonempty(),
      environment: z.record(z.string(), z.string()).default({}),
      cwd: z.string().optional(),
      enabled: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("remote"),
      url: z.string(),
      headers: z.record(z.string(), z.string()).default({}),
      enabled: z.boolean().default(true),
    })
    .strict(),
])

export const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    /** "provider/model" used when nothing else is specified. */
    model: z.string().optional(),
    /** Cheaper model for titles and other side work. Falls back to `model`. */
    smallModel: z.string().optional(),
    agent: z.record(z.string(), AgentConfigSchema).default({}),
    provider: z.record(z.string(), ProviderConfigSchema).default({}),
    mcp: z.record(z.string(), McpConfigSchema).default({}),
    /** Tool name (or "bash:<prefix>") -> ask | allow | deny. */
    permission: z.record(z.string(), PermissionSchema).default({}),
    keybinds: z.record(z.string(), z.string()).default({}),
    theme: z.string().default("jarvis"),
    /** Extra instruction files appended to the system prompt. Globs allowed. */
    instructions: z.array(z.string()).default([]),
    /** Max tool-call steps in one turn before the loop stops. */
    maxSteps: z.number().default(200),
  })
  .strict()

export type Config = z.infer<typeof ConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type AgentConfig = z.infer<typeof AgentConfigSchema>
export type McpConfig = z.infer<typeof McpConfigSchema>
export type Permission = z.infer<typeof PermissionSchema>

export class ConfigError extends Error {}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Later sources win. Objects merge recursively; arrays and scalars replace. */
export function merge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in base ? merge(base[key], value) : value
  }
  return out
}

const SUBSTITUTION = /\{(env|file):([^}]+)\}/g

/** Expands `{env:NAME}` and `{file:path}` inside every string in the tree. */
export function substitute(value: unknown, dir: string): unknown {
  if (typeof value === "string") {
    return value.replace(SUBSTITUTION, (_, kind: string, arg: string) => {
      if (kind === "env") return process.env[arg] ?? ""
      const path = isAbsolute(arg) ? arg : join(dir, arg)
      if (!existsSync(path)) throw new ConfigError(`{file:${arg}} not found (resolved to ${path})`)
      return readFileSync(path, "utf8").trim()
    })
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, dir))
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, dir)]))
  }
  return value
}

function readConfigFile(path: string): unknown {
  const errors: ParseError[] = []
  const parsed = parseJsonc(readFileSync(path, "utf8"), errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new ConfigError(`${path}: invalid JSONC at offset ${errors[0]!.offset}`)
  return substitute(parsed, dirname(path))
}

function findIn(dir: string): string | undefined {
  for (const name of configNames) {
    const path = join(dir, name)
    if (existsSync(path)) return path
  }
}

/**
 * Config files that apply to `cwd`, outermost first: the global one, then for every
 * directory from the project root down to cwd its `jarvis.json[c]` and then its
 * `.jarvis/jarvis.json[c]`. Nearest wins.
 */
export function configFiles(cwd: string): string[] {
  const found: string[] = []
  const global = findIn(configDir)
  if (global) found.push(global)
  for (const dir of ancestors(cwd)) {
    for (const candidate of [findIn(dir), findIn(join(dir, ".jarvis"))]) {
      if (candidate) found.push(candidate)
    }
  }
  return found
}

export function loadConfig(cwd = process.cwd()): Config {
  let raw: unknown = {}
  for (const path of configFiles(cwd)) raw = merge(raw, readConfigFile(path))
  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
    throw new ConfigError(`invalid jarvis config:\n${issues.join("\n")}`)
  }
  return result.data
}
