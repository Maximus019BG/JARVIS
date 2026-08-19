import type { Choice } from "./components/dialog.tsx"

/** Enough of an SDK to talk to most OpenAI-shaped endpoints, which most custom ones are. */
export const DEFAULT_NPM = "@ai-sdk/openai-compatible"

/**
 * How a provider proves who you are.
 *
 * - `key`          — you paste an API key.
 * - `none`         — a local server; asking for a key would be a step that does nothing.
 * - `device-token` — the hosted gateway, which reuses this device's pairing token. Nothing to
 *                    type, and nothing to store: the token already lives in credentials.json.
 */
export type Auth = "key" | "none" | "device-token"

/** Where the model list for a provider comes from, once we have a key to ask with. */
export type Discovery =
  | { kind: "openai" }
  | { kind: "anthropic" }
  | { kind: "catalog" }
  | { kind: "none" }

export type Preset = {
  id: string
  label: string
  hint: string
  npm: string
  export?: string
  baseURL?: string
  askBaseURL: boolean
  askNpm: boolean
  auth: Auth
  discovery: Discovery
  /**
   * Offered when discovery finds nothing, so choosing a preset always ends with at least one
   * usable model rather than an empty list and a shrug.
   */
  models: readonly string[]
  /** Catalog keys on models.dev, for metadata enrichment. */
  catalogKeys?: readonly string[]
  /** Hidden until `jarvis pair` has run — its credential *is* the pairing. */
  requiresPairing?: boolean
}

/**
 * The point of this list is that nobody should have to know an npm package name to get started.
 * Ordered by how likely it is to be what the reader wants, with `custom` last because it is the
 * only entry that asks real questions.
 */
export const PRESETS: readonly Preset[] = [
  {
    id: "jarvis",
    label: "JARVIS (hosted)",
    hint: "no key needed — uses this paired device",
    npm: DEFAULT_NPM,
    askBaseURL: false,
    askNpm: false,
    auth: "device-token",
    discovery: { kind: "openai" },
    models: ["jarvis-default"],
    requiresPairing: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "Claude — console.anthropic.com",
    npm: "@ai-sdk/anthropic",
    askBaseURL: false,
    askNpm: false,
    auth: "key",
    discovery: { kind: "anthropic" },
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    catalogKeys: ["anthropic"],
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "GPT — platform.openai.com",
    npm: "@ai-sdk/openai",
    askBaseURL: false,
    askNpm: false,
    auth: "key",
    discovery: { kind: "openai" },
    models: ["gpt-5", "gpt-5-mini"],
    catalogKeys: ["openai"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "one key, most models — openrouter.ai",
    npm: DEFAULT_NPM,
    baseURL: "https://openrouter.ai/api/v1",
    askBaseURL: false,
    askNpm: false,
    auth: "key",
    discovery: { kind: "openai" },
    models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5"],
    catalogKeys: ["openrouter"],
  },
  {
    id: "google",
    label: "Google",
    hint: "Gemini — aistudio.google.com",
    npm: "@ai-sdk/google",
    askBaseURL: false,
    askNpm: false,
    auth: "key",
    discovery: { kind: "none" },
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    catalogKeys: ["google"],
  },
  {
    id: "groq",
    label: "Groq",
    hint: "fast open models — console.groq.com",
    npm: DEFAULT_NPM,
    baseURL: "https://api.groq.com/openai/v1",
    askBaseURL: false,
    askNpm: false,
    auth: "key",
    discovery: { kind: "openai" },
    models: ["llama-3.3-70b-versatile"],
    catalogKeys: ["groq"],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    hint: "whatever you have pulled — no key",
    npm: DEFAULT_NPM,
    baseURL: "http://localhost:11434/v1",
    // Offered, because a non-default port is common and the alternative is a failed test and
    // no obvious way to fix it from here.
    askBaseURL: true,
    askNpm: false,
    auth: "none",
    discovery: { kind: "openai" },
    models: ["llama3.2"],
  },
  {
    id: "custom",
    label: "Something else",
    hint: "any OpenAI-shaped endpoint, or any AI SDK package",
    npm: DEFAULT_NPM,
    askBaseURL: true,
    askNpm: true,
    auth: "key",
    discovery: { kind: "openai" },
    models: [],
  },
]

export const findPreset = (id: string): Preset | undefined => PRESETS.find((preset) => preset.id === id)

/** The hosted provider, named once so the first-run hand-off does not hardcode the string. */
export const HOSTED_PRESET_ID = "jarvis"

/**
 * Presets to offer.
 *
 * The hosted option is shown to an unpaired device too, with a hint saying what picking it
 * will do. Hiding it used to be the safe-looking choice — it cannot work without a token —
 * but the effect was that the one option costing no API key was invisible to exactly the
 * people who had not got one yet. Now choosing it opens the pairing flow and comes back,
 * so the choice is offered and then made to work rather than withheld.
 */
export function presetChoices({ paired }: { paired: boolean }): Choice[] {
  return PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.label,
    hint: !paired && preset.requiresPairing ? `${preset.hint} · pairs this device first` : preset.hint,
  }))
}
