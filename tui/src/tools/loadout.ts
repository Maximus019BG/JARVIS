import type { ModelMessage } from "ai"
import { normalize, resolveToolName } from "../agent/repair.ts"
import type { ToolSet } from "./index.ts"

/**
 * The tools whose schemas ride along in every request.
 *
 * Everything else is announced by name and one line in `tool_search`, and only serialized
 * once the model asks for it — the same trade `skill` already makes for its instructions,
 * and for the same reason: a session that never opens a drawing should not pay 3.6k tokens
 * a turn for the tools that draw.
 *
 * `webfetch` is here despite being small enough to defer. The nine aliases it has collected
 * in `repair.ts` are evidence that models reach for a network tool unprompted, and a
 * deferred tool that is constantly guessed at costs more in round trips than it saves.
 *
 * `skill` and `tool_search` are here because they are the discovery tools. Putting a
 * discovery tool behind a discovery tool helps nobody.
 */
export const CORE_TOOLS: readonly string[] = [
  "ask",
  "bash",
  "edit",
  "glob",
  "grep",
  "list",
  "read",
  "skill",
  "task",
  "todo",
  "tool_search",
  "webfetch",
  "write",
]

/**
 * Catalog lines for the deferred built-ins. Written by hand rather than cut from each tool's
 * own description, because those descriptions are long for a reason — they teach the model
 * how to use the tool — and what is wanted here is only enough to decide whether to load it.
 */
const SUMMARIES: Record<string, string> = {
  blueprint: "List, create, inspect or delete blueprints, and read their version history",
  blueprint_check: "Check a drawing against wiring, load, protection and clearance rules",
  blueprint_edit: "Draw on a blueprint: add or move geometry, place parts, wire ports together",
  blueprint_symbol: "Find and place standard IEC electrical, architectural and IoT symbols",
  blueprint_sync: "Push or pull a blueprint's history to the paired cloud account",
  blueprint_view: "Render a blueprint as braille, SVG or JSON, at any commit",
  engineering_calc: "Electrical, structural, building-physics and IoT formulas, to EU standards",
}

/**
 * Tools worth loading alongside the one that was asked for.
 *
 * Directional on purpose: reaching for `blueprint_edit` means a drawing session, and a
 * drawing session needs to look at what it drew — `blueprint_edit`'s own description ends
 * "check it and fix what looks wrong", which it cannot do without `blueprint_view`. The
 * three siblings together are 596 tokens against a whole extra round trip. Asking for
 * `blueprint_view` alone pulls nothing: looking is not drawing.
 */
const GROUPS: Record<string, string[]> = {
  blueprint_edit: ["blueprint", "blueprint_view", "blueprint_check"],
  blueprint_symbol: ["blueprint", "blueprint_view", "blueprint_check"],
}

/** First sentence of a description, for an MCP or custom tool with no hand-written summary. */
function summarise(description: string | undefined, limit = 110): string {
  const text = (description ?? "").replace(/\s+/g, " ").trim()
  if (!text) return "no description"
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text
  const trimmed = sentence.length > limit ? `${sentence.slice(0, limit - 1).trimEnd()}…` : sentence
  return trimmed.replace(/\.$/, "")
}

export type Loadout = {
  /** Names to hand `streamText` as `activeTools` for the next step. */
  active(): string[]
  /** Every tool that exists, loaded or not — for repair, and for the error messages. */
  all(): string[]
  /** The names that are not core, in catalog order. */
  deferred(): string[]
  /** The catalog `tool_search` advertises. Stable for the life of the loadout. */
  catalog(): string
  /** Marks names loaded. Returns the ones it recognised, resolved to their real spelling. */
  load(names: string[]): string[]
  /**
   * Loads everything. The safety valve: on the last retry of a turn that keeps failing on
   * tool names, jarvis gives up on saving tokens and sends the request it would have sent
   * before this existed. Deferred loading must never turn a turn that would have worked
   * into one that does not.
   */
  loadAll(): void
  /** Candidate names for a search term: exact, then spelling drift, then substring. */
  find(query: string): string[]
  has(name: string): boolean
}

export type LoadoutOptions = {
  /**
   * Names to treat as core beyond `CORE_TOOLS`. Used for the tools in `.jarvis/tools` and
   * the ones plugins register: somebody wrote those for this project, there are rarely more
   * than a handful, and a custom tool the model never sees is a custom tool that does not
   * work. MCP is the opposite case and stays deferred — that is the payload that grows
   * without anybody in this repo deciding it should.
   */
  core?: Iterable<string>
  /** Loaded from the start — normally the tools the transcript already shows in use. */
  eager?: Iterable<string>
  /**
   * Tools that load themselves when a condition holds, rather than by being asked for.
   * `bash_output` is the case this exists for: it is meaningless until a background command
   * has actually been started, and asking the model to search for it after starting one is
   * a round trip to tell it something jarvis already knows.
   */
  auto?: Record<string, () => boolean>
}

export const TOOL_SEARCH = "tool_search"

export function createLoadout(
  tools: ToolSet,
  { core: extra = [], eager = [], auto = {} }: LoadoutOptions = {},
): Loadout {
  // `tool_search` is built from the loadout, so it cannot be in `tools` yet when this runs.
  // It is core by definition and the caller registers it straight after; naming it here keeps
  // `active()` and `all()` honest without a second pass.
  const names = [...Object.keys(tools).filter((name) => name !== TOOL_SEARCH), TOOL_SEARCH]
  const always = new Set([...CORE_TOOLS, ...extra])
  const core = names.filter((name) => always.has(name))
  const deferred = names.filter((name) => !always.has(name)).sort()
  const loaded = new Set<string>()

  // A tool's description may be a function of its call context, which cannot be resolved here
  // and is not worth resolving: a tool that computes its own description gets its name only.
  const summary = (name: string) => {
    if (SUMMARIES[name]) return SUMMARIES[name]
    const described = tools[name]?.description
    return summarise(typeof described === "string" ? described : undefined)
  }

  const find = (query: string): string[] => {
    const term = query.trim()
    if (!term) return []
    if (deferred.includes(term)) return [term]
    // The same aliases and spelling drift the call repair uses, so `blueprint_create` loads
    // `blueprint` here too instead of coming back empty.
    const resolved = resolveToolName(term, deferred)
    if (resolved) return [resolved.tool]
    // Every word over the name and the summary both, so "symbol", "draw" and "create
    // blueprint" each land somewhere useful. Ordered by name so the answer does not depend
    // on registration order.
    const words = term.split(/\s+/).map(normalize).filter(Boolean)
    return deferred.filter((name) => {
      const haystack = normalize(name) + normalize(summary(name))
      return words.every((word) => haystack.includes(word))
    })
  }

  for (const name of eager) if (deferred.includes(name)) loaded.add(name)

  return {
    active: () => {
      const on = new Set(core)
      for (const name of loaded) on.add(name)
      for (const [name, when] of Object.entries(auto)) {
        if (deferred.includes(name) && when()) on.add(name)
      }
      return [...on]
    },
    all: () => [...names],
    deferred: () => [...deferred],
    // Every deferred tool, loaded or not: a catalog that shrank as tools were loaded would
    // change this tool's description between steps, which is a payload change for no gain.
    catalog: () => deferred.map((name) => `- ${name}: ${summary(name)}`).join("\n"),
    load: (wanted) => {
      const resolved = new Set<string>()
      for (const name of wanted) for (const match of find(name)) resolved.add(match)
      for (const name of [...resolved]) {
        for (const sibling of GROUPS[name] ?? []) if (deferred.includes(sibling)) resolved.add(sibling)
      }
      for (const name of resolved) loaded.add(name)
      return [...resolved]
    },
    loadAll: () => {
      for (const name of deferred) loaded.add(name)
    },
    find,
    has: (name) => names.includes(name),
  }
}

/**
 * Tool names the transcript already shows being called.
 *
 * This is how a loaded tool survives to the next turn without any state to keep: a user three
 * messages into a drawing does not pay the load round trip again, and because it is derived
 * from the history rather than held in memory, it survives a session reloaded from disk.
 * Compaction drops the history and the set resets, which is the right answer anyway.
 */
export function toolsUsedIn(messages: readonly ModelMessage[]): string[] {
  const used = new Set<string>()
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (typeof part === "object" && part !== null && part.type === "tool-call") used.add(part.toolName)
    }
  }
  return [...used]
}
