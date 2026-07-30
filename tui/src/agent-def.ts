import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import matter from "gray-matter"
import { AgentConfigSchema, type AgentConfig, type Config } from "./config.ts"
import { resourceFiles } from "./discover.ts"

export type Agent = AgentConfig & { name: string; description: string }

/**
 * `build` can do anything; `plan` is read-only so it can explore and propose without
 * touching the workspace. Users add their own via config or `.jarvis/agent/*.md`.
 */
const BUILTIN: Record<string, Partial<AgentConfig> & { description: string }> = {
  build: {
    description: "General-purpose agent with full tool access. The default.",
  },
  plan: {
    description: "Read-only agent for investigating and proposing changes without modifying anything.",
    prompt:
      "You are in plan mode. You cannot modify the workspace. Investigate thoroughly, then present a concrete plan: what to change, in which files, and how to verify it.",
    tools: { write: false, edit: false, bash: false },
  },
}

/** Reads `.jarvis/agents/<name>.md`: frontmatter is config, the body is the prompt. */
function loadMarkdownAgents(cwd: string): Record<string, Partial<AgentConfig> & { description?: string }> {
  const agents: Record<string, Partial<AgentConfig> & { description?: string }> = {}
  for (const path of resourceFiles(cwd, "agents", ".md")) {
    const parsed = matter(readFileSync(path, "utf8"))
    agents[basename(path, ".md")] = {
      ...(parsed.data as Partial<AgentConfig>),
      prompt: parsed.content.trim() || undefined,
    }
  }
  return agents
}

/** Every available agent, keyed by name. Later sources override earlier ones. */
export function loadAgents(config: Config, cwd = process.cwd()): Record<string, Agent> {
  const sources = [BUILTIN, loadMarkdownAgents(cwd), config.agent]
  const merged: Record<string, Record<string, unknown>> = {}
  for (const source of sources) {
    for (const [name, definition] of Object.entries(source)) {
      merged[name] = { ...merged[name], ...definition }
    }
  }

  const agents: Record<string, Agent> = {}
  for (const [name, raw] of Object.entries(merged)) {
    const { description, ...rest } = raw
    const parsed = AgentConfigSchema.parse(rest)
    if (!parsed.enabled) continue
    agents[name] = { ...parsed, name, description: String(description ?? `the ${name} agent`) }
  }
  return agents
}

export const DEFAULT_AGENT = "build"

export function resolveAgent(agents: Record<string, Agent>, name = DEFAULT_AGENT): Agent {
  const agent = agents[name]
  if (!agent) throw new Error(`unknown agent "${name}" (available: ${Object.keys(agents).join(", ")})`)
  return agent
}

/** Agents the `task` tool may delegate to. */
export function spawnableAgents(agents: Record<string, Agent>): { name: string; description: string }[] {
  return Object.values(agents)
    .filter((agent) => agent.spawnable)
    .map(({ name, description }) => ({ name, description }))
}

/** An agent's prompt, reading `promptFile` if that is how it was configured. */
export function agentPrompt(agent: Agent, cwd: string): string | undefined {
  if (agent.prompt) return agent.prompt
  if (!agent.promptFile) return undefined
  const path = agent.promptFile.startsWith("/") ? agent.promptFile : join(cwd, agent.promptFile)
  if (!existsSync(path)) throw new Error(`agent "${agent.name}": promptFile not found: ${path}`)
  return readFileSync(path, "utf8").trim()
}
