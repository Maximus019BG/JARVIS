import type { Config, ProviderConfig } from "../config/config.ts"
import { readCredentials, type Credentials } from "../blueprint/credentials.ts"
import { DEFAULT_NPM } from "../ui/provider-presets.ts"
import { listModels } from "./provider.ts"

/** The synthesized provider id. Matches the `jarvis` preset, so the two cannot drift apart. */
export const HOSTED_ID = "jarvis"

/** Models the gateway always answers for. Discovery can widen this; it must never be empty. */
const HOSTED_MODELS = ["jarvis-default", "jarvis-max"]

/**
 * The hosted gateway as a provider entry.
 *
 * An OpenAI-compatible client sends the API key as `Authorization: Bearer <key>`, and the web
 * app's device auth reads exactly that header — so this device's pairing token *is* the
 * credential, and no new auth mechanism is needed on either side.
 */
export function hostedEntry(credentials: Credentials): ProviderConfig {
  return {
    name: "JARVIS (hosted)",
    npm: DEFAULT_NPM,
    options: {
      baseURL: `${credentials.baseUrl.replace(/\/$/, "")}/api/gateway/v1`,
      apiKey: credentials.token,
    },
    models: Object.fromEntries(HOSTED_MODELS.map((id) => [id, { options: {} }])),
    enabled: true,
  }
}

/**
 * Gives an otherwise-empty config one working provider, so a freshly paired install can send a
 * message before configuring anything.
 *
 * Injected at the CLI boundary rather than inside `loadConfig` — config loading stays
 * device-agnostic, and it is what the tests exercise — and rather than inside `provider.ts`,
 * where resolution runs per turn and a provider that blinks in and out would be unreadable.
 *
 * Never persisted. The token lives only in this process's memory, so it cannot reach
 * jarvis.jsonc, a session transcript, or anything `/export` produces.
 */
export function withHostedFallback(config: Config, credentials = safeCredentials()): Config {
  // Somebody who configured their own provider gets what they configured. This is a floor, not
  // a default that competes.
  if (!credentials || listModels(config).length > 0) return config
  const provider = { ...config.provider, [HOSTED_ID]: hostedEntry(credentials) }
  return {
    ...config,
    provider,
    // Only if they had no preference. A `model` naming a provider they are about to add back
    // must survive us passing through.
    model: config.model ?? `${HOSTED_ID}/${HOSTED_MODELS[0]}`,
  }
}

/** The gateway's base URL for this device, or undefined when unpaired. */
export function hostedBaseURL(): string | undefined {
  const credentials = safeCredentials()
  return credentials ? `${credentials.baseUrl.replace(/\/$/, "")}/api/gateway/v1` : undefined
}

/** This device's pairing token, which doubles as the gateway's API key. */
export function hostedToken(): string | undefined {
  return safeCredentials()?.token
}

/** Reading credentials throws on a corrupt file; a missing model is not worth failing over. */
function safeCredentials(): Credentials | undefined {
  try {
    return readCredentials()
  } catch {
    return undefined
  }
}

/**
 * What to do about having no model, when there is still nothing to run. Returns undefined once
 * something is configured, so a caller can use it as the whole empty state.
 */
export function hostedGuidance(config: Config): string | undefined {
  if (listModels(config).length > 0) return undefined
  return [
    "No model yet.",
    "",
    "  /provider   set one up here — a key is all it takes",
    "  jarvis pair link this device for a hosted model with no key at all",
  ].join("\n")
}
