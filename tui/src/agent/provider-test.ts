import { generateText } from "ai"
import { substitute, type Config, type ProviderConfig } from "../config/config.ts"
import { explainAuth, SECRET_KEY } from "../config/provider-status.ts"
import { forgetProvider, needsInstall, resolveModel, ProviderError } from "./provider.ts"

/**
 * Where a provider stopped working. Each stage has a different fix, which is the whole reason
 * the test exists: "it didn't work" sends the reader back to the docs, "the package installed
 * but exports no factory" tells them what to change.
 */
export type Stage = "install" | "factory" | "auth" | "network" | "model"

export type TestOutcome =
  | { ok: true; modelID: string; ms: number }
  | { ok: false; stage: Stage; message: string; hint?: string }

const HINTS: Record<Stage, string> = {
  install: "check the package name, and that this machine can reach the npm registry",
  factory: "the package loaded but exposes no provider factory — set `export` to the right name",
  auth: "the endpoint rejected the credential",
  network: "nothing answered at that URL — check the base URL, and that the server is running",
  model: "the provider answered, but not for that model id",
}

/**
 * How long the round-trip itself may take. Without it a provider that accepts a connection and
 * never answers leaves the wizard's last step spinning forever, with no outcome and no choices —
 * the reader's only way out is to abandon a draft that is otherwise finished.
 */
const TIMEOUT_MS = 30_000

const INSTALL_SHAPED = /failed to install/i
const FACTORY_SHAPED = /exports no create\*|has no callable export|did not return an AI SDK provider/i
const NETWORK_SHAPED =
  /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed out|network|socket hang up|abort|Unable to connect/i
const AUTH_SHAPED = /api[ -]?key|x-api-key|unauthorized|authentication|forbidden|\b401\b|\b403\b/i

/**
 * Removes anything that looks like the credential from text on its way to the screen. Provider
 * SDKs sometimes echo the key back inside an error body, and this outcome ends up in a panel,
 * which is text a screenshot can carry off.
 */
export function scrub(message: string, entry: ProviderConfig): string {
  let out = message
  for (const [key, value] of Object.entries(entry.options)) {
    if (!SECRET_KEY.test(key)) continue
    if (typeof value === "string" && value.length >= 8) out = out.split(value).join("«redacted»")
  }
  return out.replace(/\b(sk|jvd)[-_][A-Za-z0-9_-]{8,}/g, "«redacted»")
}

/**
 * Which stage a failure belongs to. Pure, and ordered most-specific first: an install failure
 * often mentions the network, and an auth failure often mentions the model, so the cheap
 * substring checks have to run in the order that a human would read them.
 */
export function classifyFailure(
  error: unknown,
  config: Config,
  cwd: string,
  id: string,
  entry: ProviderConfig,
): Extract<TestOutcome, { ok: false }> {
  const raw = error instanceof Error ? error.message : String(error)
  const stage: Stage = INSTALL_SHAPED.test(raw)
    ? "install"
    : FACTORY_SHAPED.test(raw)
      ? "factory"
      : AUTH_SHAPED.test(raw)
        ? "auth"
        : NETWORK_SHAPED.test(raw)
          ? "network"
          : "model"

  // An auth failure is the one case where there is a better message than the SDK's: explainAuth
  // knows the `{env:…}` or `{secret:…}` template behind it, which is the actual cause almost
  // every time. It needs the entry in the config it reads, hence the synthetic one.
  const message =
    stage === "auth" ? explainAuth(raw, { ...config, provider: { ...config.provider, [id]: entry } }, cwd, id) : raw

  return { ok: false, stage, message: scrub(message, entry), hint: HINTS[stage] }
}

/**
 * The entry actually tested.
 *
 * A draft is not a config file: only `readConfigFile` expands `{env:…}` and `{secret:…}`, so a
 * draft handed straight to the provider factory sends the *template* as the credential — which
 * every provider reads as a bad key. And a stored key has no secret on disk until the flow is
 * saved, so there is nothing for `{secret:…}` to expand to yet; `key` is that value, carried in
 * memory. Without this the check failed on auth no matter how good the key was.
 */
export function probeEntry(entry: ProviderConfig, cwd: string, key?: string): ProviderConfig {
  const options = substitute(entry.options, cwd) as Record<string, unknown>
  return { ...entry, options: key ? { ...options, apiKey: key } : options }
}

/**
 * A real round-trip against a candidate provider.
 *
 * Takes the entry rather than reading it out of the config, so the wizard can verify a draft
 * that is not on disk yet — which is what lets a failed test be corrected instead of saved.
 *
 * Deliberately a completion and not a GET /models: a 200 from a models endpoint says nothing
 * about whether the npm package installed or whether the first-`create*`-export guess picked
 * the right factory, and those are where custom providers actually break.
 */
export async function testProvider(args: {
  config: Config
  cwd: string
  id: string
  entry: ProviderConfig
  /** The credential to test with, for a draft whose secret is not on disk yet. */
  key?: string
  modelID?: string
  signal?: AbortSignal
}): Promise<TestOutcome> {
  const { config, cwd, id, signal } = args
  // Everything below — the round-trip, the redaction, the auth explanation — works from the
  // entry as it will actually be talked to, not as it will be written.
  const entry = probeEntry(args.entry, cwd, args.key)
  const modelID = args.modelID ?? Object.keys(entry.models)[0]
  if (!modelID) return { ok: false, stage: "model", message: "no model to test", hint: "pick at least one model" }

  const synthetic: Config = { ...config, provider: { ...config.provider, [id]: entry } }
  const started = Date.now()
  let deadline: AbortSignal | undefined
  try {
    // The draft's options differ from anything cached under this id — a stale factory built from
    // the previous attempt's key would make a corrected key look like it still fails.
    forgetProvider(id)
    const resolved = await resolveModel(synthetic, `${id}/${modelID}`)
    // Started after the install, not around it: a cold `bun add` legitimately takes tens of
    // seconds, and a deadline covering it would report a working provider as broken.
    deadline = AbortSignal.timeout(TIMEOUT_MS)
    await generateText({
      model: resolved.model,
      prompt: "ping",
      maxOutputTokens: 1,
      abortSignal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    })
    return { ok: true, modelID, ms: Date.now() - started }
  } catch (error) {
    // Only our own deadline is worth renaming: a caller that aborted has already stopped
    // listening, and the SDK's own "aborted" text would read as a mystery to everyone else.
    const failed =
      deadline?.aborted && !signal?.aborted
        ? new Error(`timed out after ${TIMEOUT_MS / 1000}s waiting for a reply`)
        : error
    return classifyFailure(failed, config, cwd, id, entry)
  } finally {
    // Either way the cached factory came from a draft, not from the saved config.
    forgetProvider(id)
  }
}

/** Whether a test will pause on an install first, so the caller can say so before awaiting. */
export const testWillInstall = (entry: ProviderConfig): boolean => needsInstall(entry.npm)

export { ProviderError }
