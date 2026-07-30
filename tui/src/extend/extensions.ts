import type { Config } from "./config.ts"
import { projectRoot } from "./discover.ts"
import { loadPlugins, NO_PLUGINS, type Plugins } from "./plugin.ts"
import { loadSkills, type Skill } from "./skill.ts"
import { loadCustomTools, type CustomToolDefinition } from "./tools/custom.ts"

/**
 * Everything a `.jarvis` directory contributes at runtime, loaded once at startup
 * rather than per turn: custom tools, skills and plugins.
 */
export type Extensions = {
  tools: Record<string, CustomToolDefinition>
  skills: Skill[]
  plugins: Plugins
  worktree: string
  /** Problems found while loading, surfaced in the UI instead of crashing. */
  errors: string[]
}

export const NO_EXTENSIONS: Extensions = {
  tools: {},
  skills: [],
  plugins: NO_PLUGINS,
  worktree: process.cwd(),
  errors: [],
}

export async function loadExtensions(config: Config, cwd = process.cwd()): Promise<Extensions> {
  const worktree = projectRoot(cwd)
  const [tools, skills, plugins] = await Promise.all([
    loadCustomTools(cwd),
    Promise.resolve(loadSkills(cwd)),
    loadPlugins(cwd, config, worktree),
  ])
  return {
    tools: { ...tools.definitions, ...plugins.tools },
    skills: skills.skills,
    plugins,
    worktree,
    errors: [...tools.errors, ...skills.errors, ...plugins.errors],
  }
}

/** One-line summary for the status area and `/mcp`-style reporting. */
export function summary(extensions: Extensions): string {
  const parts = [
    `${Object.keys(extensions.tools).length} custom tools`,
    `${extensions.skills.length} skills`,
    `${extensions.plugins.hooks.length} plugins`,
  ]
  return parts.join(", ")
}
