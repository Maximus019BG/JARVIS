import { NoSuchToolError, type ToolCallRepairFunction } from "ai"
import { MCP_PREFIX } from "../extend/mcp.ts"
import type { ToolSet } from "../tools/index.ts"
import type { Loadout } from "../tools/loadout.ts"

/**
 * Second line of defence against a hallucinated tool name, after the `<tools>` block in the
 * system prompt and before the retry in `agent.ts`.
 *
 * Most providers pass an unknown name straight through, and the AI SDK turns it into a
 * `NoSuchToolError` it offers us a chance to fix without another round trip. (Some gateways
 * validate server-side instead and reject the whole completion; nothing here can see that one
 * — that is what the retry is for.)
 */

type Repair = {
  /** The tool actually meant. */
  tool: string
  /** Injected as `action` when the call has none — see `ALIASES`. */
  action?: string
}

/**
 * Names that have arrived from a model, or are one obvious step from one that has.
 *
 * Two families, both earned:
 *
 * - `webfetch` under every name a model expects a network tool to have. `browse` is the one
 *   that cost a real turn.
 * - `<tool>_<action>` for the tools whose `action` field is an enum. A description reading
 *   `action:"place"` is read as a tool called `blueprint_place`, which is the other half of
 *   the same failure; the wording was fixed too, but the model still has priors. The action is
 *   carried across, because the name and the action say the same thing and dropping it would
 *   only trade this error for a schema one.
 *
 * Deliberately no fuzzy matching. `blueprint_edit` and `blueprint_check` differ by a few
 * characters and one of them commits to git; guessing between them is worse than failing.
 */
const ALIASES: Record<string, Repair> = {
  browse: { tool: "webfetch" },
  browser: { tool: "webfetch" },
  fetch: { tool: "webfetch" },
  fetch_url: { tool: "webfetch" },
  url_fetch: { tool: "webfetch" },
  web_fetch: { tool: "webfetch" },
  web_search: { tool: "webfetch" },
  search_web: { tool: "webfetch" },
  open_url: { tool: "webfetch" },
  blueprint_place: { tool: "blueprint_symbol", action: "place" },
  place_symbol: { tool: "blueprint_symbol", action: "place" },
  blueprint_place_symbol: { tool: "blueprint_symbol", action: "place" },
  blueprint_list_symbols: { tool: "blueprint_symbol", action: "list" },
  // The cloud MCP server spells it plural; a model that has seen both surfaces mixes them up.
  blueprint_symbols: { tool: "blueprint_symbol" },
  blueprint_create: { tool: "blueprint", action: "create" },
  blueprint_delete: { tool: "blueprint", action: "delete" },
  blueprint_info: { tool: "blueprint", action: "info" },
  blueprint_list: { tool: "blueprint", action: "list" },
  blueprint_history: { tool: "blueprint", action: "history" },
}

/** Case, separators and the MCP prefix are all noise when comparing two tool names. */
export const normalize = (name: string): string =>
  name
    .toLowerCase()
    .replace(new RegExp(`^${MCP_PREFIX}`), "")
    .replace(/[^a-z0-9]/g, "")

/**
 * The registered tool a name was probably reaching for, or `undefined` when nothing is close
 * enough to act on. A wrong guess runs the wrong tool; the retry loop is the safer fallback.
 */
export function resolveToolName(name: string, registered: string[]): Repair | undefined {
  const alias = ALIASES[name.toLowerCase()]
  if (alias && registered.includes(alias.tool)) return alias

  // Spelling drift only: webFetch, web-fetch, bash-output, the mcp_ prefix dropped or added.
  const wanted = normalize(name)
  const matches = registered.filter((tool) => normalize(tool) === wanted)
  return matches.length === 1 ? { tool: matches[0]! } : undefined
}

/**
 * Rewrites the call, preserving the arguments. `input` is JSON text on the wire, so a call
 * whose arguments are not an object is passed through untouched rather than rebuilt.
 */
function rewrite(input: string, repair: Repair): string {
  if (!repair.action) return input
  try {
    const args = JSON.parse(input || "{}") as unknown
    if (!args || typeof args !== "object" || Array.isArray(args)) return input
    const record = args as Record<string, unknown>
    if ("action" in record) return input
    return JSON.stringify({ action: repair.action, ...record })
  } catch {
    return input
  }
}

/**
 * `onRepair` reports what was rewritten. Silently rerouting a call the model did not make is
 * the sort of thing nobody notices for a week, so the transcript says so.
 */
export function toolCallRepair(
  onRepair?: (from: string, to: string) => void,
  loadout?: Loadout,
): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools, error }) => {
    // The SDK offers this hook for a bad name and for bad arguments alike. Only the first is
    // ours: with the name already right, `resolveToolName` would match it to itself and hand
    // back the same failing call, announcing a repair that did nothing.
    if (!NoSuchToolError.isInstance(error)) return null
    // `tools` here is the step's *active* set, so under deferred loading it does not contain
    // the tools that exist but have not been loaded. The loadout knows all of them.
    const repair = resolveToolName(toolCall.toolName, loadout ? loadout.all() : Object.keys(tools))
    if (!repair) return null

    // A tool that is real but not loaded yet. Rather than fail the call — which costs the
    // whole turn on a gateway that validates server-side — turn it into the load it needed.
    // The result says the tool is callable, the next step carries its schema, and the model
    // makes the call it was already trying to make.
    if (loadout && !loadout.active().includes(repair.tool)) {
      onRepair?.(toolCall.toolName, `tool_search, to load ${repair.tool}`)
      return { ...toolCall, toolName: "tool_search", input: JSON.stringify({ names: [repair.tool] }) }
    }

    if (repair.tool === toolCall.toolName) return null
    onRepair?.(toolCall.toolName, repair.tool)
    return { ...toolCall, toolName: repair.tool, input: rewrite(toolCall.input, repair) }
  }
}
