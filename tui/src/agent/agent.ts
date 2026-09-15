import { stepCountIs, streamText, type ModelMessage } from "ai"
import { agentPrompt, loadAgents, resolveAgent, spawnableAgents, type Agent } from "./agent-def.ts"
import { blueprintRoot } from "../blueprint/store.ts"
import type { Config } from "../config/config.ts"
import { explainAuth } from "../config/provider-status.ts"
import { NO_EXTENSIONS, type Extensions } from "../extend/extensions.ts"
import { PermissionDenied, type PermissionGate } from "../permission.ts"
import { fire, wrapTools } from "../extend/plugin.ts"
import { providerOf, record } from "./metrics.ts"
import { systemPrompt } from "./prompt.ts"
import { toolCallRepair } from "./repair.ts"
import { defaultModelID, resolveModel, type ResolvedModel } from "./provider.ts"
import { customTools } from "../extend/custom-tools.ts"
import { skillTool } from "../extend/skill-tool.ts"
import { builtinTools, filterTools, gateTools, MAX_DEPTH, ToolError, type ToolSet } from "../tools/index.ts"
import { createLoadout, toolsUsedIn } from "../tools/loadout.ts"
import { toolSearchTool } from "../tools/tool-search.ts"
import { startedBackground } from "../tools/background.ts"

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
   * The previous session in this directory, for the system prompt's continuity block.
   * Supplied by the interactive UI only: a subagent has no history of its own to resume,
   * and a headless run is a script rather than a conversation being picked back up.
   */
  previous?: { title: string; created: number }
  /**
   * Files read so far, keyed to the mtime they had when read. Owned by the caller so it
   * survives across turns; a fresh map per turn would make the model re-read every file.
   */
  read?: Map<string, number>
  abort?: AbortSignal
  depth?: number
  onEvent?: (event: AgentEvent) => void
  /**
   * Puts a multiple-choice question to the user. Only the interactive UI supplies one;
   * without it the `ask` tool is not built, so a headless run cannot stall on a question
   * nobody will see.
   */
  ask?: (question: string, options: string[]) => Promise<string>
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

/**
 * The one place a thrown value becomes something a person can read. `ToolError` and
 * `PermissionDenied` both extend `Error`, so the first line covers them.
 *
 * The rest exists because `String(error)` on a plain object is `"[object Object]"`, which
 * is the least useful thing a transcript can say. Providers and the AI SDK routinely throw
 * shapes that carry a perfectly good message without being `instanceof Error` — a bundled
 * copy of the SDK is a different realm, and API failures arrive as plain payloads. Dig the
 * message out, and fall back to JSON rather than to nothing.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    if (typeof record.message === "string" && record.message) return record.message
    const nested = record.error
    if (typeof nested === "string" && nested) return nested
    if (nested && typeof nested === "object") {
      const inner = (nested as Record<string, unknown>).message
      if (typeof inner === "string" && inner) return inner
    }
    try {
      return JSON.stringify(error)
    } catch {
      return "an error that could not be described"
    }
  }
  return String(error)
}

/**
 * Groq returns this as assistant text when the model failed to emit a usable tool call.
 * It can arrive under finish reason `failed_generation` or plain `stop`, so it is matched
 * by text, not by finish reason.
 */
const GROQ_REFUSAL_SIGNATURE = "Failed to call a function"

/**
 * Some gateways validate the model's tool calls against the tools the request carried and
 * reject the whole completion server-side, rather than passing the bad name through for the
 * SDK — and `repair.ts` — to deal with. The wording is the provider's, so match loosely.
 */
const UNKNOWN_TOOL = /not in request\.tools|no such tool|unknown tool|is not a valid tool|tool .* does not exist/i

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
          const at = Date.now()
          const result = await run({
            ...options,
            agent: name,
            model: agents[name]?.model,
            messages: [{ role: "user", content: prompt }],
            // A subagent is handed a task, not a thread it was part of yesterday. Passing the
            // parent's continuity down would have it apologising for a session it never had.
            previous: undefined,
            // Shared, not copied: a file the subagent read shouldn't force the parent to re-read.
            read,
            depth: depth + 1,
            onEvent: (event) => onEvent({ type: "sub", agent: name, event }),
          })
          // The parent's usage accumulator only ever sees its own streamText steps, so
          // without this a subagent's tokens are spent and invisible — missing from the
          // status line and from every total.
          record({
            at,
            ms: Date.now() - at,
            provider: providerOf(result.model),
            model: result.model,
            input: result.usage.input,
            output: result.usage.output,
            cost: result.usage.cost,
            error: result.error,
            session: options.sessionID,
            agent: name,
          })
          return result.text || "(the subagent returned no output)"
        }
      : undefined

  const ctx = {
    cwd,
    check: config.check,
    worktree: extensions.worktree,
    blueprints: blueprintRoot(config),
    gate: agentGate,
    read,
    depth,
    agent: agent.name,
    sessionID,
    spawn,
    ask: options.ask,
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
  // `tool_search` reveals a schema and does nothing else; the tool it loads is gated as it
  // always was, at the point it actually runs. Prompting for the lookup would be theatre.
  const selfGated = new Set([...Object.keys(builtins), ...Object.keys(custom), "skill", "tool_search"])
  const gated = gateTools(filterTools(available, agent.tools, agent.defaultTools), agentGate, selfGated)
  const tools = wrapTools(gated, plugins, { sessionID, agent: agent.name })

  // Which of those tools actually ride along in each request. Every tool stays registered —
  // registration is free, only serialization is not — and `prepareStep` names the subset.
  // `filterTools` has already run, so an agent's `write: false` never reaches the catalog and
  // `tool_search` cannot load it back.
  const loadout = config.lazyTools
    ? createLoadout(tools, {
        // `.jarvis/tools` and anything a plugin registered. Written for this project, few in
        // number, and useless if the model never sees them.
        core: Object.keys(custom),
        // What the transcript already shows in use. Two turns into a drawing the schemas are
        // simply there, and because this is read off the history rather than held in memory it
        // survives a session reloaded from disk.
        eager: toolsUsedIn(messages),
        auto: { bash_output: startedBackground },
      })
    : undefined
  // Nothing to defer, nothing to search: a small agent should not carry a lookup tool for an
  // empty catalog. Same idiom as `skill`, `ask` and `task` above.
  const deferring = Boolean(loadout && loadout.deferred().length > 0)
  if (loadout && deferring) tools.tool_search = toolSearchTool(loadout)

  // Named in the system prompt and in the retry hint below. A model that is not told the set
  // guesses at it, and a guess costs the whole turn on a gateway that validates server-side.
  const toolNames = Object.keys(tools).sort()

  /**
   * What the tools are, for the messages below. Under deferred loading that is two answers —
   * what is on the wire right now, and what one `tool_search` call away. Saying only the
   * first would send a model looking for `blueprint_edit` away empty-handed.
   */
  const offered = () =>
    deferring && loadout
      ? `${loadout.active().sort().join(", ")} — plus these, once loaded with tool_search: ${loadout.deferred().join(", ")}`
      : toolNames.join(", ")

  const contextLimit = model.info.contextLimit
  const outgoing = { messages }
  await fire(plugins, "chat.message", { agent: agent.name, model: modelID, sessionID }, outgoing)

  let text = ""
  let contextTokens = 0
  /** The last failure already emitted, so the rethrow below can avoid repeating it. */
  let reported: string | undefined
  const usage: Usage = { input: 0, output: 0, cost: 0 }

  // Some gateways — Groq in particular — reject a malformed tool call with finish reason
  // `failed_generation` instead of returning a tool call, and it is stochastic: the same
  // request often succeeds on a retry. Loop a bounded number of times, telling the model
  // the previous attempt produced nothing, rather than leaving the user staring at the
  // gateway's raw "Failed to call a function" message.
  const MAX_RETRIES = 2
  let retries = 0

  for (;;) {
    // Fallback history for an abort that throws instead of ending the stream. A finished
    // step always holds each tool call paired with its result, which is what providers
    // require; a half-finished step is dropped rather than sent back orphaned.
    const completed: ModelMessage[] = []

    const result = streamText({
      model: model.model,
      system: systemPrompt({
        config,
        cwd,
        agentPrompt: agentPrompt(agent, cwd),
        previous: options.previous,
        toolNames: deferring && loadout ? loadout.active().sort() : toolNames,
        deferredTools: deferring,
      }),
      messages: outgoing.messages,
      tools,
      temperature: agent.temperature,
      stopWhen: stepCountIs(config.maxSteps),
      abortSignal: abort,
      // Only the active subset is serialized for the provider — the SDK filters `tools` by
      // this list before converting any schema, so an unloaded tool costs literally nothing.
      // Re-read every step, so a `tool_search` in step N is on the wire in step N + 1.
      prepareStep: deferring && loadout ? () => ({ activeTools: loadout.active() }) : undefined,
      providerOptions: model.info.options as Record<string, Record<string, never>> | undefined,
      // Catches a hallucinated name the provider passed through, without a second round trip.
      // Announced rather than applied quietly: rerouting a call the model did not make is not
      // something the transcript should have to be read twice to notice.
      repairToolCall: toolCallRepair(
        (from, to) =>
          emit({ type: "error", message: `the model called "${from}", which does not exist — using ${to} instead` }),
        deferring ? loadout : undefined,
      ),
      onStepFinish: ({ response }) => {
        completed.push(...response.messages)
      },
      // No `onError` here: `fullStream` already yields the same failure as an `error` part, and
      // reporting it from both is how one missing API key became three identical messages.
    })

    let failedGeneration = false
    /** Set when the provider rejected the completion for naming a tool it was not offered. */
    let unknownTool = false
    // Groq returns the refusal as assistant text; the finish reason can be `failed_generation`
    // or plain `stop`, so the text signature is what makes detection reliable across both.
    let sawToolCall = false
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
            sawToolCall = true
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
            if (part.rawFinishReason === "failed_generation" && retries < MAX_RETRIES) failedGeneration = true
            break
          case "error":
            // Explained here rather than at the transcript, so the throw path below compares
            // against the same string and still recognises it as already reported.
            reported = explainAuth(errorMessage(part.error), config, cwd, model.providerID)
            unknownTool = UNKNOWN_TOOL.test(reported)
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

    // Groq's refusal can arrive as plain assistant text with finish reason `stop` rather than
    // `failed_generation`, so match the refusal signature too. Only safe to retry when nothing
    // was executed this attempt — a real tool call followed by a late failure would be lost.
    if (
      !failedGeneration &&
      retries < MAX_RETRIES &&
      !sawToolCall &&
      text.startsWith(GROQ_REFUSAL_SIGNATURE)
    ) {
      failedGeneration = true
    }

    // A rejected completion is the same situation arriving as a hard error instead of a finish
    // reason, and the same retry fixes it — the model is simply told which tools exist. Guarded
    // by `sawToolCall` for the same reason as above: a real call followed by a late failure
    // must not be replayed.
    if (!failedGeneration && unknownTool && retries < MAX_RETRIES && !sawToolCall) failedGeneration = true

    if (!failedGeneration) {
      // Report the outcome, not the provider's wording. Matching on GROQ_REFUSAL_SIGNATURE
      // alone let every other phrasing — and an empty response — fall through both branches
      // and end the turn with nothing said and nothing appended to the session, which reads
      // as jarvis having ignored the prompt. Skipped when the stream already emitted a real
      // error: that one names the actual cause, and this one would only bury it.
      if (!reported && !sawToolCall && !text.trim()) {
        emit({
          type: "error",
          message:
            "The model returned nothing — no text and no tool call, usually because it could not produce a valid call for the tools available. Try a stronger model, or name the tool you want explicitly (e.g. \"render the blueprint with blueprint_view\").",
        })
      } else if (text.startsWith(GROQ_REFUSAL_SIGNATURE)) {
        emit({
          type: "error",
          message:
            "The model kept failing to produce a valid tool call and the provider rejected it. This usually means the model is weak at tool calling for the tools available — try a stronger model, or rephrase the request to name the tool explicitly (e.g. \"render the blueprint with blueprint_view\").",
        })
      } else if (unknownTool) {
        // The provider's own wording was already emitted and names the tool it refused; this
        // says what it means and what to do, which that wording never does. Reached either
        // with the retries spent, or on the first attempt when a tool had already run and
        // replaying it was not safe.
        emit({
          type: "error",
          message: `The model called a tool that does not exist, and the provider rejected the request. The tools available this turn are: ${offered()}. Name one of them explicitly, or use a model that follows a tool list more closely.`,
        })
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

    // Retry. Discard the failed attempt's output — its assistant message is just the gateway's
    // error text, which is noise the model should not see — and steer the next attempt with a
    // user-role hint so the history stays provider-agnostic.
    retries++
    // Last attempt, and the model is still reaching for a tool that is not on the wire. Stop
    // saving tokens: load everything, so the final request is the one jarvis would have sent
    // before deferred loading existed. Whatever else this feature does, it must never be the
    // reason a turn fails. Only for `unknownTool` — a `failed_generation` is the model
    // struggling with a schema it already has, and adding more schemas makes that worse.
    if (unknownTool && loadout && retries === MAX_RETRIES) loadout.loadAll()
    text = ""
    contextTokens = 0
    // Belongs to the attempt being discarded. Left set, it would still be here when a later
    // attempt returns, and the dedupe above would misjudge which failures were already shown.
    reported = undefined
    outgoing.messages = [
      ...outgoing.messages,
      {
        role: "user",
        content: unknownTool
          ? `Your previous attempt called a tool that does not exist, so the provider rejected it and nothing was executed. The only tools available are: ${offered()}. Try again: pick exactly one of those by name, and emit a small, valid JSON object for its arguments that matches that tool's schema.`
          : "Your previous attempt failed to produce a valid tool call (the provider reported `failed_generation`), so nothing was executed. Try again: pick exactly one tool from the ones offered, and emit a small, valid JSON object for its arguments that matches that tool's schema — do not invent tool names or arguments. Prefer flat fields over nested arrays when the schema allows.",
      },
    ]
    emit({
      type: "error",
      message: unknownTool
        ? `the model called a tool that does not exist — retrying (${retries}/${MAX_RETRIES})`
        : `the model failed to generate a valid tool call — retrying (${retries}/${MAX_RETRIES})`,
    })
  }
}

/** The model an agent will actually use, for display before a run starts. */
export function effectiveModel(config: Config, agent: Agent, override?: string): string {
  return override ?? agent.model ?? defaultModelID(config)
}
