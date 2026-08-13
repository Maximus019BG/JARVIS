import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ModelConfig } from "../config/config.ts"
import { dataDir } from "../config/paths.ts"

/**
 * Context limits and prices for public models, from models.dev. Only ever a fallback for
 * what the config does not say, so cost and compaction work on a model you did not
 * hand-annotate. Best effort by design: offline, rate-limited or malformed all mean "no
 * extra metadata", never a failed startup.
 */
const URL = "https://models.dev/api.json"
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const cachePath = join(dataDir, "models.dev.json")

type CatalogModel = {
  name?: string
  reasoning?: boolean
  limit?: { context?: number; output?: number }
  /** USD per million tokens, the same unit as `ModelConfig.cost`. */
  cost?: { input?: number; output?: number }
}
type Catalog = Record<string, { models?: Record<string, CatalogModel> }>

const fresh = (path: string) => existsSync(path) && Date.now() - statSync(path).mtimeMs < TTL_MS

let pending: Promise<Catalog> | undefined

function load(): Promise<Catalog> {
  pending ??= (async () => {
    try {
      if (fresh(cachePath)) return JSON.parse(readFileSync(cachePath, "utf8")) as Catalog
      const response = await fetch(URL, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error(`${response.status}`)
      const body = (await response.json()) as Catalog
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
      writeFileSync(cachePath, JSON.stringify(body))
      return body
    } catch {
      // A stale cache still beats nothing when the network is gone.
      try {
        return JSON.parse(readFileSync(cachePath, "utf8")) as Catalog
      } catch {
        return {}
      }
    }
  })()
  return pending
}

/** Drops undefined entries so spreading this cannot blank out a configured value. */
function defined(model: CatalogModel): ModelConfig {
  const info: ModelConfig = {}
  if (model.name !== undefined) info.name = model.name
  if (model.reasoning !== undefined) info.reasoning = model.reasoning
  if (model.limit?.context !== undefined) info.contextLimit = model.limit.context
  if (model.limit?.output !== undefined) info.outputLimit = model.limit.output
  if (model.cost?.input !== undefined && model.cost.output !== undefined) {
    info.cost = { input: model.cost.input, output: model.cost.output }
  }
  return info
}

/**
 * Catalog metadata for one model, or `{}`. `keys` are the provider names to try, in
 * order: the config's provider id first, then whatever the npm package suggests, since
 * `provider.velocity` pointing at `@ai-sdk/anthropic` is still an Anthropic model.
 */
export async function modelInfo(keys: string[], modelID: string): Promise<ModelConfig> {
  // Set JARVIS_NO_CATALOG to stay off the network entirely; tests never reach it.
  if (process.env.JARVIS_NO_CATALOG || process.env.NODE_ENV === "test") return {}
  const catalog = await load()
  for (const key of keys) {
    const found = catalog[key]?.models?.[modelID]
    if (found) return defined(found)
  }
  return {}
}

/**
 * Every model the catalog knows for these provider keys — the other half of models.dev, which
 * until now was only ever asked about a model the reader had already named. Used by setup to
 * offer a list instead of demanding an exact id from memory.
 */
export async function catalogModels(keys: string[]): Promise<{ id: string; name: string }[]> {
  if (process.env.JARVIS_NO_CATALOG || process.env.NODE_ENV === "test") return []
  const catalog = await load()
  const out = new Map<string, string>()
  for (const key of keys) {
    for (const [id, model] of Object.entries(catalog[key]?.models ?? {})) {
      // First key wins: `keys` is ordered by how much we trust it, same as `modelInfo`.
      if (!out.has(id)) out.set(id, model.name ?? id)
    }
  }
  return [...out].map(([id, name]) => ({ id, name }))
}

/** `@ai-sdk/anthropic` -> `anthropic`, so a renamed provider entry still resolves. */
export function catalogKey(npm: string): string {
  return npm.replace(/^@[^/]+\//, "").replace(/-provider$/, "")
}
