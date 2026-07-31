import { stepCountIs, streamText, type ModelMessage } from "ai"
import { agentPrompt, loadAgents, resolveAgent, spawnableAgents, type Agent } from "./agent-def.ts"
import type { Config } from "../config/config.ts"
import { explainAuth } from "../config/provider-status.ts"
import { NO_EXTENSIONS, type Extensions } from "../extend/extensions.ts"
import { PermissionDenied, type PermissionGate } from "../permission.ts"
import { fire, wrapTools } from "../extend/plugin.ts"
import { systemPrompt } from "./prompt.ts"
import { defaultModelID, resolveModel, type ResolvedModel } from "./provider.ts"
import { customTools } from "../extend/custom-tools.ts"
import { skillTool } from "../extend/skill-tool.ts"
import { builtinTools, filterTools, gateTools, MAX_DEPTH, ToolError, type ToolSet } from "../tools/index.ts"

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
  /**
   * Files read so far, keyed to the mtime they had when read. Owned by the caller so it
   * survives across turns; a fresh map per turn would make the model re-read every file.
   */
  read?: Map<string, number>
  abort?: AbortSignal
  depth?: number
  onEvent?: (event: AgentEvent) => void
}

export type RunResult = {
  /** Assistant and tool messages produced by this turn, to append to the history. */
  messages: ModelMessage[]
  text: string
  usage: Usage
  /** True when the abort signal cut the turn short. `messages` holds the completed steps. */
  interrupted?: boolean
  /** The resolved model's context window, when known, so the caller can decide to compact. */
  contextLimit?: number
  /**
   * Prompt tokens on the final step, i.e. how full the window actually got. `usage.input`
   * sums every step and so counts the same history once per step; it is right for cost and
   * wrong for occupancy.
   */
  contextTokens: number
  /** The model this turn actually used, as `provider/model`, for per-provider accounting. */
  model: string
  /**
   * Set when the turn failed and the failure was already reported as an `error` event. The
   * caller must not report it again — it is here so a caller can still tell the turn failed.
   */
  error?: string
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
    read = new Map<string, number>(),
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
            // Shared, not copied: a file the subagent read shouldn't force the parent to re-read.
            read,
            depth: depth + 1,
            onEvent: (event) => onEvent({ type: "sub", agent: name, event }),
          })
          return result.text || "(the subagent returned no output)"
        }
      : undefined

  const ctx = {
    cwd,
    check: config.check,
    worktree: extensions.worktree,
    gate: agentGate,
    read,
    depth,
    agent: agent.name,
    sessionID,
    spawn,
  }
  const builtins = builtinTools(ctx, spawn ? spawnableAgents(agents) : [])
  const custom = customTools(extensions.tools, ctx)
  const available = {
    ...builtins,
    ...(extensions.skills.length > 0 ? { skill: skillTool(ctx, extensions.skills) } : {}),
    ...custom,
    ...extraTools,
  }
  // Built-ins, skills and custom tools call the gate themselves with a useful title and
  // detail. Everything else — MCP, plugin-contributed tools — gets the generic check, so
  // nothing reaches the model ungated.
  const selfGated = new Set([...Object.keys(builtins), ...Object.keys(custom), "skill"])
  const gated = gateTools(filterTools(available, agent.tools, agent.defaultTools), agentGate, selfGated)
  const tools = wrapTools(gated, plugins, { sessionID, agent: agent.name })

  const contextLimit = model.info.contextLimit
  const outgoing = { messages }
  await fire(plugins, "chat.message", { agent: agent.name, model: modelID, sessionID }, outgoing)

  // Fallback history for an abort that throws instead of ending the stream. A finished
  // step always holds each tool call paired with its result, which is what providers
  // require; a half-finished step is dropped rather than sent back orphaned.
  const completed: ModelMessage[] = []

  const result = streamText({
    model: model.model,
    system: systemPrompt({ config, cwd, agentPrompt: agentPrompt(agent, cwd) }),
    messages: outgoing.messages,
    tools,
    temperature: agent.temperature,
    stopWhen: stepCountIs(config.maxSteps),
    abortSignal: abort,
    providerOptions: model.info.options as Record<string, Record<string, never>> | undefined,
    onStepFinish: ({ response }) => {
      completed.push(...response.messages)
    },
    // No `onError` here: `fullStream` already yields the same failure as an `error` part, and
    // reporting it from both is how one missing API key became three identical messages.
  })

  let text = ""
  let contextTokens = 0
  /** The last failure already emitted, so the rethrow below can avoid repeating it. */
  let reported: string | undefined
  const usage: Usage = { input: 0, output: 0, cost: 0 }

  try {
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
          contextTokens = part.usage.inputTokens ?? contextTokens
          usage.input += part.usage.inputTokens ?? 0
          usage.output += part.usage.outputTokens ?? 0
          usage.cost = cost(model, usage.input, usage.output)
          emit({ type: "usage", usage: { ...usage } })
          break
        case "error":
          // Explained here rather than at the transcript, so the throw path below compares
          // against the same string and still recognises it as already reported.
          reported = explainAuth(errorMessage(part.error), config, cwd, model.providerID)
          emit({ type: "error", message: reported })
          break
        default:
          break
      }
    }
  } catch (error) {
    // An abort usually ends the stream cleanly and is handled below. It only lands here if
    // it interrupted something mid-flight, and then the finished steps are still worth
    // keeping so the next turn knows what already touched disk.
    if (!abort?.aborted) throw error
    return { messages: completed, text, usage, interrupted: true, contextLimit, contextTokens, model: model.id }
  }

  try {
    return {
      messages: await result.responseMessages,
      text,
      usage,
      interrupted: abort?.aborted,
      contextLimit,
      contextTokens,
      model: model.id,
    }
  } catch (error) {
    // The same failure the stream already emitted arrives here again when the promise
    // rejects. Throwing would have the caller note it a second time, so hand it back as
    // data instead. A failure that was never emitted still throws and is reported once.
    const message = explainAuth(errorMessage(error), config, cwd, model.providerID)
    if (message !== reported) throw error
    return { messages: completed, text, usage, contextLimit, contextTokens, model: model.id, error: message }
  }
}

/** The model an agent will actually use, for display before a run starts. */
export function effectiveModel(config: Config, agent: Agent, override?: string): string {
  return override ?? agent.model ?? defaultModelID(config)
}
