import { existsSync, readFileSync } from "node:fs"
import { parse as parseJsonc } from "jsonc-parser"
import { configFiles, merge, type Config } from "./config.ts"
import { secretRefName } from "./secrets.ts"

/** Keys whose value must never be printed, whatever a provider chooses to call them. */
export const SECRET_KEY = /key|token|secret|password/i

/**
 * Where a provider's credential stands right now.
 *
 * - `ok`      — something non-empty resolved.
 * - `empty`   — a credential is configured but expanded to nothing, i.e. an unset `{env:…}`.
 *               This is the state that looks configured and is not, and it is why a missing
 *               key used to surface as an opaque error from the provider's own SDK.
 * - `absent`  — no credential configured at all. Legitimate for ollama and the like, so it
 *               is reported neutrally rather than as a fault.
 */
export type Reach = {
  state: "ok" | "empty" | "absent"
  /** The env var named by an `{env:NAME}` template, when that is how the key is configured. */
  env?: string
  /** The name inside a `{secret:name}` template, when the key lives in secrets.json instead. */
  secret?: string
  /** The config file that last declared this provider. */
  file?: string
  /** Synthesized rather than declared — the hosted provider, which has no config file at all. */
  builtin?: boolean
}

/**
 * `substitute` runs at load, so a loaded Config cannot tell an unset env var from a key that
 * was never configured — both are absent-or-empty, and the variable's *name* is gone. Reading
 * the raw text back is the cheap way to recover it; the alternative is a side channel out of
 * `loadConfig`, which every other caller would then have to carry.
 */
export function reachability(config: Config, cwd: string): Record<string, Reach> {
  let raw: Record<string, unknown> = {}
  const declaredIn: Record<string, string> = {}

  for (const path of configFiles(cwd)) {
    if (!existsSync(path)) continue
    try {
      // Deliberately no `substitute`: the unexpanded templates are the whole point.
      const parsed = parseJsonc(readFileSync(path, "utf8"), [], { allowTrailingComma: true }) as
        | Record<string, unknown>
        | undefined
      const providers = parsed?.provider
      if (providers && typeof providers === "object") {
        for (const id of Object.keys(providers)) declaredIn[id] = path
      }
      raw = merge(raw, parsed) as Record<string, unknown>
    } catch {
      // loadConfig already rejects a malformed file; here a bad one just costs us the name.
    }
  }

  const rawProviders = (raw.provider ?? {}) as Record<string, { options?: Record<string, unknown> }>
  const out: Record<string, Reach> = {}

  for (const id of Object.keys(config.provider)) {
    const options = config.provider[id]!.options
    const field = Object.keys(options).find((key) => SECRET_KEY.test(key))
    const file = declaredIn[id]
    if (!field) {
      out[id] = { state: "absent", file }
      continue
    }
    const template = rawProviders[id]?.options?.[field]
    const env = typeof template === "string" ? /^\{env:([^}]+)\}$/.exec(template)?.[1] : undefined
    const secret = typeof template === "string" ? secretRefName(template) : undefined
    const value = options[field]
    // No template at all *and* no declaring file means nobody wrote this down: it is the hosted
    // provider synthesized at startup. Saying "not found" about its config file would be true
    // and useless.
    const builtin = template === undefined && file === undefined ? true : undefined
    out[id] = {
      state: typeof value === "string" && value.length > 0 ? "ok" : "empty",
      env,
      secret,
      file,
      builtin,
    }
  }
  return out
}

/** Failures that mean "the credential did not work", across every provider's wording. */
const AUTH_SHAPED = /api[ -]?key|x-api-key|unauthorized|authentication|forbidden|\b401\b|\b403\b/i

/**
 * Turns an auth failure into something the reader can act on. A provider's SDK reports the
 * symptom — a 401, or a complaint about `apiKey` — and says nothing about the `{env:…}`
 * template that quietly expanded to nothing, which is the actual cause almost every time.
 */
export function explainAuth(message: string, config: Config, cwd: string, providerID: string): string {
  if (!AUTH_SHAPED.test(message)) return message
  let reach: Reach | undefined
  try {
    reach = reachability(config, cwd)[providerID]
  } catch {
    // Re-reading the config is a nicety; never let it turn one failure into two.
  }
  if (!reach || reach.state === "ok") return message
  return `no usable API key for "${providerID}" — ${describeGap(reach)}\n  ${message}\n  /provider view ${providerID}`
}

/** Why a credential is not usable, phrased as the thing to go fix. */
export function describeGap(reach: Reach): string {
  if (reach.state === "ok") return "it resolves"
  if (reach.state === "absent") return "no key is configured for it"
  if (reach.env) return `${reach.env} is not set in this shell`
  if (reach.secret) return `no key stored for it — /provider setup ${reach.secret.replace(/-api-key$/, "")}`
  return "its configured key expands to nothing"
}

/**
 * The one-glance answer to "is anything wrong with my providers", for the status line. Pure over
 * `reachability`, so it can be memoized on [config, cwd] and tested without a renderer.
 *
 * Only `empty` counts. `absent` is legitimate — ollama and friends need no key — and reporting
 * it would train the reader to ignore the indicator.
 */
export function providerHealth(config: Config, cwd: string): { broken: string[]; warning?: string } {
  let reach: Record<string, Reach>
  try {
    reach = reachability(config, cwd)
  } catch {
    return { broken: [] }
  }
  const broken = Object.keys(reach)
    .filter((id) => reach[id]!.state === "empty")
    .sort()
  if (broken.length === 0) return { broken }
  const warning =
    broken.length === 1
      ? `⚠ ${broken[0]} has no key`
      : `⚠ ${broken.length} providers have no key`
  return { broken, warning }
}

/**
 * The env var `/provider add` will point a new provider at. One rule for everything, so a
 * custom id lands somewhere predictable: `anthropic` → `ANTHROPIC_API_KEY`, `my-llm` →
 * `MY_LLM_API_KEY`.
 */
export const envName = (id: string): string => `${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`
