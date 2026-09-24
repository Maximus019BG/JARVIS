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
 * Provider ids for hosted voice, one per wizard preset (`jarvis-voice` transcribes,
 * `jarvis-speech` speaks), so whichever the reader picks lands on an entry that has the token.
 */
export const HOSTED_VOICE_IDS = ["jarvis-voice", "jarvis-speech"] as const
const HOSTED_TRANSCRIBE = "jarvis-voice/whisper-large-v3-turbo"
const HOSTED_SPEECH = "jarvis-speech/canopylabs/orpheus-v1-english"

/**
 * The gateway's audio endpoints as a provider entry. `@ai-sdk/openai` rather than the chat
 * entry's openai-compatible package, because only it has `.transcription()` and `.speech()` —
 * and it already calls `/audio/transcriptions` and `/audio/speech` under whatever base URL it
 * is given. No models listed, so it never shows up in the chat model picker.
 */
export function hostedVoiceEntry(credentials: Credentials): ProviderConfig {
  return { ...hostedEntry(credentials), name: "JARVIS voice (hosted)", npm: "@ai-sdk/openai", models: {} }
}

/**
 * Gives a paired device hosted voice by default, and an otherwise-empty config one working chat
 * provider, so a freshly paired install can talk and send a message before configuring anything.
 *
 * Injected at the CLI boundary rather than inside `loadConfig` — config loading stays
 * device-agnostic, and it is what the tests exercise — and rather than inside `provider.ts`,
 * where resolution runs per turn and a provider that blinks in and out would be unreadable.
 *
 * Never persisted. The token lives only in this process's memory, so it cannot reach
 * jarvis.jsonc, a session transcript, or anything `/export` produces. The hosted voice entries
 * are written over any persisted ones for the same reason: the wizard saves them keyless.
 */
export function withHostedFallback(config: Config, credentials = safeCredentials()): Config {
  if (!credentials) return config

  const voiceEntry = hostedVoiceEntry(credentials)
  // Hosted unless the reader picked their own transcription provider. The backend has no
  // realtime socket, so hosted dictation is always the push-to-talk upload.
  const hostedListen = !config.voice?.model || config.voice.model.startsWith(`${HOSTED_VOICE_IDS[0]}/`)
  const voiced: Config = {
    ...config,
    provider: { ...config.provider, ...Object.fromEntries(HOSTED_VOICE_IDS.map((id) => [id, voiceEntry])) },
    voice: {
      stream: true,
      speak: false,
      ...config.voice,
      ...(hostedListen ? { model: config.voice?.model ?? HOSTED_TRANSCRIBE, stream: false } : {}),
      speakModel: config.voice?.speakModel ?? HOSTED_SPEECH,
    },
  }

  // Somebody who configured their own chat provider gets what they configured. This is a floor,
  // not a default that competes.
  if (listModels(config).length > 0) return voiced
  return {
    ...voiced,
    provider: { ...voiced.provider, [HOSTED_ID]: hostedEntry(credentials) },
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
    "  /pair       link this device for a hosted model with no key at all",
    "  /provider   set one up here — a key is all it takes",
  ].join("\n")
}
