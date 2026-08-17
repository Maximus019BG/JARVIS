import type { ProviderConfig } from "../config/config.ts"
import type { Write } from "../config/provider-plan.ts"
import { envName } from "../config/provider-status.ts"
import { secretName, secretRef } from "../config/secrets.ts"
import type { Choice } from "./components/dialog.tsx"
import { findPreset, presetChoices, type Preset } from "./provider-presets.ts"

/**
 * The provider setup flow, as a reducer over a draft. Deliberately free of React and of I/O:
 * every rule about what to ask, in what order, and what counts as valid lives here as a pure
 * function, so the flow can be asserted step-by-step in a test instead of driven by hand.
 */

export type StepKind =
  | "preset"
  | "id"
  | "npm"
  | "baseURL"
  | "keyMode"
  | "key"
  | "envName"
  | "models"
  | "test"
  | "done"

/** Where the credential comes from. `none` covers both a local server and the hosted gateway. */
export type KeyMode = "store" | "env" | "device-token" | "none"

export type Draft = {
  presetID: string
  id: string
  npm: string
  export?: string
  baseURL?: string
  keyMode: KeyMode
  /** The typed key, in memory only. Never rendered, never logged, never put in a config. */
  key: string
  envName: string
  models: string[]
  catalogKeys: readonly string[]
}

export type Setup = {
  draft: Draft
  step: StepKind
  /** Steps already answered, newest last — what `backStep` walks. */
  history: StepKind[]
  /** The last validation failure, for the step that produced it. */
  error?: string
}

export type SetupCtx = {
  /** Provider ids already in the config, so a new one cannot silently overwrite it. */
  existing: string[]
  paired: boolean
  /** Models offered at the `models` step, once discovery has run. */
  discovered?: readonly Choice[]
}

const EMPTY_DRAFT: Draft = {
  presetID: "",
  id: "",
  npm: "",
  keyMode: "store",
  key: "",
  envName: "",
  models: [],
  catalogKeys: [],
}

export function beginSetup(_ctx: SetupCtx): Setup {
  return { draft: { ...EMPTY_DRAFT }, step: "preset", history: [] }
}

/** The draft a chosen preset starts from. Everything a preset knows, nothing it has to ask. */
function applyPreset(draft: Draft, preset: Preset, ctx: SetupCtx): Draft {
  // A preset id that is already taken becomes `openai-2`, so picking "OpenAI" twice is a
  // rename rather than a refusal.
  let id = preset.id === "custom" ? "" : preset.id
  if (id && ctx.existing.includes(id)) {
    let n = 2
    while (ctx.existing.includes(`${preset.id}-${n}`)) n += 1
    id = `${preset.id}-${n}`
  }
  return {
    ...draft,
    presetID: preset.id,
    id,
    npm: preset.npm,
    export: preset.export,
    baseURL: preset.baseURL,
    keyMode: preset.auth === "key" ? "store" : preset.auth === "none" ? "none" : "device-token",
    envName: id ? envName(id) : "",
    models: [...preset.models],
    catalogKeys: preset.catalogKeys ?? [],
  }
}

const ORDER: StepKind[] = ["preset", "id", "npm", "baseURL", "keyMode", "key", "envName", "models", "test", "done"]

/** Whether a step has anything to ask, given what the preset already decided. */
function asks(step: StepKind, draft: Draft): boolean {
  const preset = findPreset(draft.presetID)
  switch (step) {
    case "npm":
      return preset?.askNpm ?? true
    case "baseURL":
      return preset?.askBaseURL ?? true
    case "keyMode":
      // Asked only for a provider the reader is hand-configuring anyway. For a known preset,
      // "paste your key" is the answer nine times in ten, and making everyone confirm that
      // first is the difference between four keypresses and six. The `key` step carries an
      // escape hatch to the environment instead — see `switchKeyMode`.
      return (preset?.askNpm ?? true) && (draft.keyMode === "store" || draft.keyMode === "env")
    case "key":
      return draft.keyMode === "store"
    case "envName":
      return draft.keyMode === "env"
    default:
      return true
  }
}

/**
 * The next step to show. This function is the "happy path is a few keypresses" claim, written
 * down: for `anthropic` it walks preset → id → models → test, and a test can assert exactly
 * that rather than trusting the sentence.
 */
export function nextStep(draft: Draft, from: StepKind): StepKind {
  for (let i = ORDER.indexOf(from) + 1; i < ORDER.length; i += 1) {
    const step = ORDER[i]!
    if (asks(step, draft)) return step
  }
  return "done"
}

/** Every step still to come, including the current one. Drives the "3 of 6" counter honestly. */
export function remainingSteps(draft: Draft, from: StepKind): StepKind[] {
  const out: StepKind[] = []
  for (let i = ORDER.indexOf(from); i < ORDER.length; i += 1) {
    const step = ORDER[i]!
    if (step !== "done" && asks(step, draft)) out.push(step)
  }
  return out
}

const PROMPTS: Record<StepKind, { title: string; prompt: string; hint?: string }> = {
  preset: { title: "provider", prompt: "Which provider?", hint: "↑↓ to move, enter to choose" },
  id: { title: "name", prompt: "What should it be called here?", hint: "lowercase; used as provider/model" },
  npm: { title: "package", prompt: "Which npm package exports the AI SDK provider?" },
  baseURL: { title: "endpoint", prompt: "What is the base URL?" },
  keyMode: { title: "key", prompt: "Where should the API key come from?" },
  // `tab`, not a ctrl chord: TextareaRenderable already claims ctrl+a/ctrl+e for line motion,
  // and ctrl+v is paste in enough terminals that binding it here would eat pasted keys.
  key: { title: "key", prompt: "Paste your API key.", hint: "stored 0600, never in your config · tab use a variable" },
  envName: { title: "key", prompt: "Which environment variable holds it?", hint: "tab paste a key instead" },
  models: { title: "models", prompt: "Which models do you want?", hint: "enter toggles, pick “done” to finish" },
  test: { title: "check", prompt: "Trying a real request…" },
  done: { title: "done", prompt: "" },
}

const KEY_MODE_CHOICES: Choice[] = [
  { value: "store", label: "Store it for me", hint: "0600 in ~/.config/jarvis/secrets.json" },
  { value: "env", label: "Read an environment variable", hint: "you export it in your shell" },
]

export type StepSpec = {
  kind: StepKind
  title: string
  prompt: string
  hint?: string
  input?: { value: string; placeholder?: string; secret?: boolean }
  choices?: Choice[]
  /** Which of the remaining steps this is, for a counter that never lies about the total. */
  position: { index: number; total: number }
  error?: string
}

export function stepSpec(setup: Setup, ctx: SetupCtx): StepSpec {
  const { draft, step } = setup
  const text = PROMPTS[step]
  // Counted over the *plan*, not over ORDER: a preset that skips three questions must not
  // claim the reader is on step 2 of 8.
  //
  // A total of 0 means "not known yet", which is the honest answer at the preset step: how many
  // questions follow depends entirely on which preset is about to be chosen. Announcing 8 and
  // then dropping to 5 reads like the form changed its mind.
  const plan = remainingSteps({ ...draft }, "preset")
  const base = {
    kind: step,
    ...text,
    position: { index: Math.max(1, plan.indexOf(step) + 1), total: step === "preset" ? 0 : plan.length },
    error: setup.error,
  }

  switch (step) {
    case "preset":
      return { ...base, choices: presetChoices({ paired: ctx.paired }) }
    case "keyMode":
      return { ...base, choices: KEY_MODE_CHOICES }
    case "models":
      return { ...base, choices: modelChoices(draft, ctx) }
    case "id":
      return { ...base, input: { value: draft.id, placeholder: draft.presetID } }
    case "npm":
      return { ...base, input: { value: draft.npm, placeholder: draft.npm } }
    case "baseURL":
      return { ...base, input: { value: draft.baseURL ?? "", placeholder: "https://…" } }
    case "key":
      return { ...base, input: { value: draft.key, secret: true } }
    case "envName":
      return { ...base, input: { value: draft.envName, placeholder: envName(draft.id) } }
    default:
      return base
  }
}

/**
 * The row that ends the models step. Leading space so it sorts first and cannot collide with a
 * real model id. Exported because the wizard has to recognise it: a second literal here is how
 * this row silently became a toggle instead of a submit.
 */
export const MODELS_DONE = " done"

/**
 * The model list: whatever discovery found, plus anything already chosen (so a preset default
 * survives an endpoint that does not list it), with a leading row that ends the step.
 */
export function modelChoices(draft: Draft, ctx: SetupCtx): Choice[] {
  const chosen = new Set(draft.models)
  const seen = new Set<string>()
  const rows: Choice[] = [
    { value: MODELS_DONE, label: `done (${chosen.size} selected)`, hint: chosen.size === 0 ? "pick at least one" : "" },
  ]
  for (const choice of [...(ctx.discovered ?? []), ...draft.models.map((id) => ({ value: id, label: id }))]) {
    if (seen.has(choice.value)) continue
    seen.add(choice.value)
    rows.push({
      ...choice,
      label: `${chosen.has(choice.value) ? "✓ " : "  "}${choice.label}`,
    })
  }
  return rows
}

const ID_SHAPE = /^[a-z][a-z0-9._-]*$/
const ENV_SHAPE = /^[A-Z][A-Z0-9_]*$/

/** Why this answer cannot be accepted, or undefined if it can. */
export function validate(setup: Setup, value: string | string[], ctx: SetupCtx): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : ""
  switch (setup.step) {
    case "preset":
      return findPreset(trimmed) ? undefined : "pick one of the listed providers"
    case "id":
      if (!ID_SHAPE.test(trimmed)) return "lowercase letters, digits, . _ - and must start with a letter"
      if (ctx.existing.includes(trimmed)) return `"${trimmed}" already exists — pick another name`
      return undefined
    case "npm":
      if (trimmed.length === 0) return "an npm package name is required"
      if (/^https?:/.test(trimmed)) return "that looks like a URL — the package name goes here"
      return undefined
    case "baseURL": {
      if (trimmed.length === 0) return "a base URL is required"
      let url: URL
      try {
        url = new URL(trimmed)
      } catch {
        return "not a URL"
      }
      return url.protocol === "http:" || url.protocol === "https:" ? undefined : "must be http or https"
    }
    case "keyMode":
      return trimmed === "store" || trimmed === "env" ? undefined : "pick one"
    case "key":
      // Not trimmed for the emptiness check: a key that is only whitespace is still empty, but
      // we must not report "ok" for one we are about to store with the spaces stripped.
      return trimmed.length === 0 ? "a key is required — or go back and read it from the environment" : undefined
    case "envName":
      return ENV_SHAPE.test(trimmed) ? undefined : "uppercase letters, digits and underscores"
    case "models":
      return (Array.isArray(value) ? value : setup.draft.models).length === 0 ? "pick at least one model" : undefined
    default:
      return undefined
  }
}

/** Records an answer and advances. On a validation failure the step does not move. */
export function submitStep(setup: Setup, value: string | string[], ctx: SetupCtx): Setup {
  const problem = validate(setup, value, ctx)
  if (problem) return { ...setup, error: problem }

  const text = typeof value === "string" ? value.trim() : ""
  let draft = setup.draft

  switch (setup.step) {
    case "preset":
      draft = applyPreset(draft, findPreset(text)!, ctx)
      break
    case "id":
      // The env var name tracks the id until the reader edits it themselves, which is why it is
      // derived here and not at the envName step.
      draft = { ...draft, id: text, envName: envName(text) }
      break
    case "npm":
      draft = { ...draft, npm: text }
      break
    case "baseURL":
      draft = { ...draft, baseURL: text }
      break
    case "keyMode":
      draft = { ...draft, keyMode: text as KeyMode }
      break
    case "key":
      draft = { ...draft, key: text }
      break
    case "envName":
      draft = { ...draft, envName: text }
      break
    case "models":
      draft = { ...draft, models: Array.isArray(value) ? value : draft.models }
      break
    default:
      break
  }

  return { draft, step: nextStep(draft, setup.step), history: [...setup.history, setup.step] }
}

/**
 * Swaps between typing a key and naming an environment variable, from inside whichever of those
 * two steps the reader is on. The escape hatch that lets the flow skip the "where should the key
 * come from?" question for every known preset without taking the choice away.
 */
export function switchKeyMode(setup: Setup, mode: "store" | "env"): Setup {
  if (setup.draft.keyMode === mode) return setup
  const draft = { ...setup.draft, keyMode: mode, envName: setup.draft.envName || envName(setup.draft.id) }
  return { ...setup, draft, step: mode === "env" ? "envName" : "key", error: undefined }
}

/** Toggles one model without leaving the step. Separate from `submitStep`, which advances. */
export function toggleModel(setup: Setup, id: string): Setup {
  const has = setup.draft.models.includes(id)
  const models = has ? setup.draft.models.filter((each) => each !== id) : [...setup.draft.models, id]
  return { ...setup, draft: { ...setup.draft, models }, error: undefined }
}

export function backStep(setup: Setup): Setup {
  const previous = setup.history[setup.history.length - 1]
  if (!previous) return setup
  return { ...setup, step: previous, history: setup.history.slice(0, -1), error: undefined }
}

/** The provider entry as it will be written. Templates only — never the key itself. */
export function draftEntry(draft: Draft): { id: string; entry: ProviderConfig } {
  const options: Record<string, unknown> = {}
  if (draft.baseURL) options.baseURL = draft.baseURL
  if (draft.keyMode === "store") options.apiKey = secretRef(secretName(draft.id))
  if (draft.keyMode === "env") options.apiKey = `{env:${draft.envName}}`
  // `device-token` and `none` get no apiKey at all: the hosted provider's credential is
  // injected at startup from credentials.json and must never reach a config file.

  return {
    id: draft.id,
    entry: {
      npm: draft.npm,
      ...(draft.export ? { export: draft.export } : {}),
      options,
      models: Object.fromEntries(draft.models.map((id) => [id, { options: {} }])),
      enabled: true,
    },
  }
}

/**
 * Everything to persist, as data. `setDefaultModel` is what makes a first provider immediately
 * usable — without it the reader adds a provider and still has no model selected.
 */
export function planWrites(draft: Draft, { setDefaultModel }: { setDefaultModel: boolean }): Write[] {
  const { id, entry } = draftEntry(draft)
  const writes: Write[] = []
  if (draft.keyMode === "store") writes.push({ kind: "secret", name: secretName(id), value: draft.key })
  writes.push({ kind: "config", path: ["provider", id], value: entry })
  if (setDefaultModel && draft.models[0]) {
    writes.push({ kind: "config", path: ["model"], value: `${id}/${draft.models[0]}` })
  }
  return writes
}

/** A one-line recap of the decisions so far, for the wizard's footer. Never includes the key. */
export function summarize(draft: Draft): string {
  const parts = [draft.id || draft.presetID, draft.npm, draft.baseURL].filter(Boolean)
  if (draft.keyMode === "env") parts.push(`{env:${draft.envName}}`)
  if (draft.keyMode === "store" && draft.key) parts.push("key stored")
  if (draft.keyMode === "device-token") parts.push("paired device")
  if (draft.models.length > 0) parts.push(`${draft.models.length} model${draft.models.length === 1 ? "" : "s"}`)
  return parts.join(" · ")
}
