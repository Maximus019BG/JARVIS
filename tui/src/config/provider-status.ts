import { existsSync, readFileSync } from "node:fs"
import { parse as parseJsonc } from "jsonc-parser"
import { configFiles, merge, type Config } from "./config.ts"

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
  /** The config file that last declared this provider. */
  file?: string
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
    const value = options[field]
    out[id] = { state: typeof value === "string" && value.length > 0 ? "ok" : "empty", env, file }
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
  const fix =
    reach.state === "empty" && reach.env
      ? `${reach.env} is not set in this shell`
      : reach.state === "empty"
        ? "its configured key expands to nothing"
        : "no key is configured for it"
  return `no usable API key for "${providerID}" — ${fix}\n  ${message}\n  /provider view ${providerID}`
}

/**
 * The env var `/provider add` will point a new provider at. One rule for everything, so a
 * custom id lands somewhere predictable: `anthropic` → `ANTHROPIC_API_KEY`, `my-llm` →
 * `MY_LLM_API_KEY`.
 */
export const envName = (id: string): string => `${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`
