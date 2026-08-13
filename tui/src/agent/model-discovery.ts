import type { Discovery } from "../ui/provider-presets.ts"
import { catalogKey, catalogModels } from "./catalog.ts"

export type Discovered = {
  id: string
  label: string
  hint?: string
  source: "endpoint" | "catalog"
}

/** How long to wait for a model list. Setup is interactive; a slow provider must not hold it. */
const TIMEOUT_MS = 6000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * `{ data: [{ id }] }` — the OpenAI shape, which most compatible endpoints copy. Tolerant on
 * purpose: a provider that answers with `{ models: [...] }`, or with bare strings, is still
 * telling us what we asked, and refusing to read it would send the reader back to typing ids.
 */
export function parseOpenAIModels(body: unknown): Discovered[] {
  if (!isRecord(body)) return []
  const rows = body.data ?? body.models
  if (!Array.isArray(rows)) return []
  const out: Discovered[] = []
  for (const row of rows) {
    const id = typeof row === "string" ? row : isRecord(row) && typeof row.id === "string" ? row.id : undefined
    if (!id) continue
    const owner = isRecord(row) && typeof row.owned_by === "string" ? row.owned_by : undefined
    out.push({ id, label: id, hint: owner, source: "endpoint" })
  }
  return out
}

/** `{ data: [{ id, display_name }] }` — Anthropic's list, which carries a nicer label. */
export function parseAnthropicModels(body: unknown): Discovered[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return []
  const out: Discovered[] = []
  for (const row of body.data) {
    if (!isRecord(row) || typeof row.id !== "string") continue
    const name = typeof row.display_name === "string" ? row.display_name : undefined
    out.push({ id: row.id, label: row.id, hint: name, source: "endpoint" })
  }
  return out
}

/**
 * Endpoint results first, then anything only the catalog knows.
 *
 * The endpoint is authoritative about what it will actually serve; models.dev is a superset that
 * includes models this key may have no access to. So the endpoint wins on a collision, and
 * catalog-only entries come after — present, because a provider whose list endpoint is missing
 * or empty should still offer something, but never ahead of a model we know exists.
 */
export function mergeDiscovered(endpoint: Discovered[], catalog: Discovered[]): Discovered[] {
  const seen = new Set(endpoint.map((entry) => entry.id))
  return [...endpoint, ...catalog.filter((entry) => !seen.has(entry.id))]
}

async function fetchModels(
  discovery: Discovery,
  baseURL: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<Discovered[]> {
  const root = baseURL.replace(/\/$/, "")
  const anthropic = discovery.kind === "anthropic"
  const url = anthropic ? `${root}/models` : `${root}/models`
  const response = await fetch(url, {
    headers: anthropic
      ? { ...(apiKey ? { "x-api-key": apiKey } : {}), "anthropic-version": "2023-06-01" }
      : apiKey
        ? { authorization: `Bearer ${apiKey}` }
        : {},
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const body: unknown = await response.json()
  return anthropic ? parseAnthropicModels(body) : parseOpenAIModels(body)
}

/**
 * What models this provider offers, best effort.
 *
 * Never throws and never rejects: this runs while a setup step is on screen, and a provider with
 * no list endpoint is a normal thing, not an error. The `note` is what the reader is told about
 * why the list is shorter than they expected.
 */
export async function discoverModels(
  args: { discovery: Discovery; baseURL?: string; apiKey?: string; npm: string; providerID?: string },
  signal?: AbortSignal,
): Promise<{ models: Discovered[]; note?: string }> {
  const keys = [args.providerID, catalogKey(args.npm)].filter((key): key is string => Boolean(key))
  const fromCatalog: Discovered[] = (await catalogModels(keys).catch(() => [])).map((entry) => ({
    id: entry.id,
    label: entry.id,
    hint: entry.name === entry.id ? undefined : entry.name,
    source: "catalog" as const,
  }))

  if (args.discovery.kind === "none" || args.discovery.kind === "catalog" || !args.baseURL) {
    return {
      models: fromCatalog,
      note: fromCatalog.length === 0 ? "no model list available — type an id if none fit" : undefined,
    }
  }

  try {
    const endpoint = await fetchModels(args.discovery, args.baseURL, args.apiKey, signal)
    const models = mergeDiscovered(endpoint, fromCatalog)
    return {
      models,
      note: endpoint.length === 0 ? "the endpoint listed no models — these are from models.dev" : undefined,
    }
  } catch (error) {
    return {
      models: fromCatalog,
      // Worth saying: a list request that fails on auth is an early sign the key is wrong, and
      // the reader is about to spend a step on models before finding out.
      note: `could not list models (${error instanceof Error ? error.message : String(error)})`,
    }
  }
}

/**
 * The default base URL to ask, for a provider whose endpoint is implied by its package rather
 * than configured. Keeps discovery working for `@ai-sdk/anthropic` and `@ai-sdk/openai`, which
 * take no `baseURL` at all.
 */
export function impliedBaseURL(npm: string): string | undefined {
  const key = catalogKey(npm)
  if (key === "anthropic") return "https://api.anthropic.com/v1"
  if (key === "openai") return "https://api.openai.com/v1"
  return undefined
}
