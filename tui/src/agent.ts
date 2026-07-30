import { stepCountIs, streamText, type ModelMessage } from "ai"
import { agentPrompt, loadAgents, resolveAgent, spawnableAgents, type Agent } from "./agent-def.ts"
import type { Config } from "./config.ts"
import { NO_EXTENSIONS, type Extensions } from "./extensions.ts"
import { PermissionDenied, type PermissionGate } from "./permission.ts"
import { fire, wrapTools } from "./plugin.ts"
import { systemPrompt } from "./prompt.ts"
import { defaultModelID, resolveModel, type ResolvedModel } from "./provider.ts"
import { customTools } from "./tools/custom.ts"
import { skillTool } from "./tools/skill.ts"
import { builtinTools, filterTools, MAX_DEPTH, ToolError, type ToolSet } from "./tools/index.ts"

export type Usage = { input: number; output: number; cost: number }

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-start"; id: string; name: string; input: unknown }
  | { type: "tool-end"; id: string; name: string; output: string; failed: boolean }
  /** A subagent event, tagged with the agent that produced it. */
  | { type: "sub"; agent: string; event: AgentEvent }
  | { type: "error"; message: string }
  | { type: "usage"; usage: Usage }

export type RunOptions = {
  config: Config
  cwd: string
  messages: ModelMessage[]
  gate: PermissionGate
  /** Agent name; defaults to `build`. */
  agent?: string
  /** "provider/model"; defaults to the agent's model, then the config's. */
  model?: string
  /** Tools contributed by MCP servers, merged in after the built-ins. */
  extraTools?: ToolSet
  /** Custom tools, skills and plugins from `.jarvis`, loaded once at startup. */
  extensions?: Extensions
  /** Session id, passed to custom tools and plugin hooks. */
  sessionID?: string
  abort?: AbortSignal
  depth?: number
  onEvent?: (event: AgentEvent) => void
}

export type RunResult = {
  /** Assistant and tool messages produced by this turn, to append to the history. */
  messages: ModelMessage[]
  text: string
  usage: Usage
}

function cost(model: ResolvedModel, input: number, output: number): number {
  if (!model.info.cost) return 0
  return (input * model.info.cost.input + output * model.info.cost.output) / 1_000_000
}

/** Tool output can be any JSON; the UI and transcript both want a string. */
function stringify(output: unknown): string {
  if (typeof output === "string") return output
  return JSON.stringify(output, null, 2) ?? String(output)
}

function errorMessage(error: unknown): string {
  if (error instanceof ToolError || error instanceof PermissionDenied) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

export async function run(options: RunOptions): Promise<RunResult> {
  const {
    config,
    cwd,
    messages,
    gate,
    extraTools,
    extensions = NO_EXTENSIONS,
    sessionID = "local",
    abort,
    depth = 0,
    onEvent = () => {},
  } = options
  const agents = loadAgents(config, cwd)
  const agent = resolveAgent(agents, options.agent)
  const modelID = options.model ?? agent.model ?? defaultModelID(config)
  const model = await resolveModel(config, modelID)
  const { plugins } = extensions

  const emit = (event: AgentEvent) => {
    onEvent(event)
    void fire(plugins, "event", { event })
  }

  // Plugins may veto or rewrite a permission before the user is prompted.
  const agentGate = gate.withRules(agent.permission).withOverride(async (request) => {
    const decision: { status?: "ask" | "allow" | "deny" } = {}
    await fire(plugins, "permission.ask", request, decision)
    return decision.status
  })

  const spawn =
    depth < MAX_DEPTH
      ? async (name: string, prompt: string) => {
          const result = await run({
            ...options,
            agent: name,
            model: agents[name]?.model,
            messages: [{ role: "user", content: prompt }],
            depth: depth + 1,
            onEvent: (event) => onEvent({ type: "sub", agent: name, event }),
          })
          return result.text || "(the subagent returned no output)"
        }
      : undefined

  const ctx = {
    cwd,
    worktree: extensions.worktree,
    gate: agentGate,
    read: new Set<string>(),
    depth,
    agent: agent.name,
    sessionID,
    spawn,
  }
  const available = {
    ...builtinTools(ctx, spawn ? spawnableAgents(agents) : []),
    ...(extensions.skills.length > 0 ? { skill: skillTool(ctx, extensions.skills) } : {}),
    ...customTools(extensions.tools, ctx),
    ...extraTools,
  }
  const tools = wrapTools(filterTools(available, agent.tools, agent.defaultTools), plugins, {
    sessionID,
    agent: agent.name,
  })

  const outgoing = { messages }
  await fire(plugins, "chat.message", { agent: agent.name, model: modelID, sessionID }, outgoing)

  const result = streamText({
    model: model.model,
    system: systemPrompt({ config, cwd, agentPrompt: agentPrompt(agent, cwd) }),
    messages: outgoing.messages,
    tools,
    temperature: agent.temperature,
    stopWhen: stepCountIs(config.maxSteps),
    abortSignal: abort,
    providerOptions: model.info.options as Record<string, Record<string, never>> | undefined,
    onError: ({ error }) => emit({ type: "error", message: errorMessage(error) }),
  })

  let text = ""
  const usage: Usage = { input: 0, output: 0, cost: 0 }

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        text += part.text
        emit({ type: "text", text: part.text })
        break
      case "reasoning-delta":
        emit({ type: "reasoning", text: part.text })
        break
      case "tool-call":
        emit({ type: "tool-start", id: part.toolCallId, name: part.toolName, input: part.input })
        break
      case "tool-result":
        emit({
          type: "tool-end",
          id: part.toolCallId,
          name: part.toolName,
          output: stringify(part.output),
          failed: false,
        })
        break
      case "tool-error":
        emit({
          type: "tool-end",
          id: part.toolCallId,
          name: part.toolName,
          output: errorMessage(part.error),
          failed: true,
        })
        break
      case "finish-step":
        usage.input += part.usage.inputTokens ?? 0
        usage.output += part.usage.outputTokens ?? 0
        usage.cost = cost(model, usage.input, usage.output)
        emit({ type: "usage", usage: { ...usage } })
        break
      case "error":
        emit({ type: "error", message: errorMessage(part.error) })
        break
      default:
        break
    }
  }

  return { messages: await result.responseMessages, text, usage }
}

/** The model an agent will actually use, for display before a run starts. */
export function effectiveModel(config: Config, agent: Agent, override?: string): string {
  return override ?? agent.model ?? defaultModelID(config)
}
