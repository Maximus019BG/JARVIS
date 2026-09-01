import type { Choice } from "./components/dialog.tsx"

/**
 * The pairing flow, as a reducer over a draft. Deliberately free of React and of I/O:
 * every rule about what to ask, in what order, and what counts as valid lives here as a
 * pure function, so the flow can be asserted step-by-step in a test instead of driven by
 * hand through a terminal. Same shape as `provider-setup.ts`, for the same reason.
 *
 * The network lives in `cli/pair-flow.ts`; this only decides what to show and when.
 */

export type StepKind =
  | "status"
  | "url"
  | "email"
  | "confirm"
  | "waiting"
  | "done"

export type Draft = {
  baseUrl: string
  /** Blank means "do not address it" — the request stays reachable by its code alone. */
  email: string
  name: string
  fingerprint: string
  platform: string
}

export type Pair = {
  draft: Draft
  step: StepKind
  /** Steps already answered, newest last — what `backStep` walks. */
  history: StepKind[]
  /** The last validation failure, for the step that produced it. */
  error?: string
  /** Filled once the server has issued a code; drives the waiting step. */
  code?: {
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    qr?: string
  }
  /** Seconds until the code expires, as counted down by the poller. */
  secondsLeft?: number
  /** Filled at `done`. */
  paired?: { deviceId: string; workstationId: string; name: string }
}

export type PairCtx = {
  /** The existing pairing, if this device already has one. */
  existing?: { deviceId: string; workstationId: string; baseUrl: string; name?: string }
  /** Prefill for the url step: `JARVIS_CLOUD_URL`, or what the installer recorded. */
  knownBaseUrl?: string
  /** Prefill for the email step, e.g. from `git config user.email`. */
  knownEmail?: string
  defaults: { name: string; fingerprint: string; platform: string }
}

export const SKIP_EMAIL = " skip"

export function beginPair(ctx: PairCtx): Pair {
  const draft: Draft = {
    baseUrl: ctx.knownBaseUrl ?? "",
    email: ctx.knownEmail ?? "",
    name: ctx.defaults.name,
    fingerprint: ctx.defaults.fingerprint,
    platform: ctx.defaults.platform,
  }
  // An already-paired device opens on its status rather than on a form: the question it is
  // being asked is "what is this paired to", and offering the first step of a new pairing
  // would make unpairing look like the only way to find out.
  if (ctx.existing) return { draft: { ...draft, baseUrl: ctx.existing.baseUrl }, step: "status", history: [] }
  return { draft, step: firstStep(draft), history: [] }
}

const ORDER: StepKind[] = ["url", "email", "confirm", "waiting", "done"]

/** Whether a step has anything to ask, given what is already known. */
function asks(step: StepKind, draft: Draft): boolean {
  // A url the environment or the installer already supplied is not a question. Asking it
  // anyway is the difference between two keypresses and four on every Pi that was set up
  // by the one-liner.
  if (step === "url") return draft.baseUrl.trim().length === 0
  return true
}

const firstStep = (draft: Draft): StepKind => (asks("url", draft) ? "url" : "email")

/** The steps still ahead, so a counter can be honest about the total. */
export function remainingSteps(draft: Draft, from: StepKind): StepKind[] {
  const start = ORDER.indexOf(from)
  if (start < 0) return []
  return ORDER.slice(start).filter((step) => step !== "done" && asks(step, draft))
}

const PROMPTS: Record<StepKind, { title: string; prompt: string; hint?: string }> = {
  status: { title: "device", prompt: "This machine is paired.", hint: "↑↓ to move, enter to choose" },
  url: { title: "cloud", prompt: "Where is your JARVIS?", hint: "the address you sign in at" },
  email: {
    title: "account",
    prompt: "Which account should approve this?",
    hint: "the request shows up in that account's Devices tab",
  },
  confirm: {
    title: "device",
    prompt: "This is what the approver will see.",
    hint: "edit the name, or enter to accept",
  },
  waiting: { title: "approve", prompt: "Waiting for approval…", hint: "esc to cancel" },
  done: { title: "done", prompt: "" },
}

export const STATUS_CHOICES: Choice[] = [
  { value: "close", label: "Close", hint: "leave the pairing as it is" },
  { value: "unpair", label: "Unpair this device", hint: "forgets it here; revoke in the web app to kill the token" },
]

export type StepSpec = {
  kind: StepKind
  title: string
  prompt: string
  hint?: string
  input?: { value: string; placeholder?: string }
  choices?: Choice[]
  /** Which of the remaining steps this is, for a counter that never lies about the total. */
  position: { index: number; total: number }
  error?: string
}

export function stepSpec(pair: Pair): StepSpec {
  const { draft, step } = pair
  const plan = remainingSteps(draft, firstStep(draft))
  const base = {
    kind: step,
    ...PROMPTS[step],
    position: {
      index: Math.max(1, plan.indexOf(step) + 1),
      // `status` and `done` are not questions, so they claim no position in the count.
      total: step === "status" || step === "done" ? 0 : plan.length,
    },
    error: pair.error,
  }

  switch (step) {
    case "status":
      return { ...base, choices: STATUS_CHOICES }
    case "url":
      return { ...base, input: { value: draft.baseUrl, placeholder: "https://jarvis.example" } }
    case "email":
      return { ...base, input: { value: draft.email, placeholder: "you@example.com" } }
    case "confirm":
      return { ...base, input: { value: draft.name, placeholder: draft.name } }
    default:
      return base
  }
}

const looksLikeUrl = (value: string): boolean => /^https?:\/\/[^\s/]+/.test(value)

/** Validation, per step. Returns the message to show, or undefined when the value is fine. */
export function validate(pair: Pair, value: string): string | undefined {
  const text = value.trim()
  switch (pair.step) {
    case "url":
      if (!text) return "an address is needed"
      // Scheme required rather than guessed: defaulting to https would silently fail on the
      // http-only dev server, and defaulting to http would downgrade a real deployment.
      if (!looksLikeUrl(text)) return "start with http:// or https://"
      return undefined
    case "email":
      // Blank is a real answer here — it means "do not address this request".
      if (!text || text === SKIP_EMAIL) return undefined
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "that does not look like an email"
      return undefined
    case "confirm":
      if (!text) return "a name is needed"
      if (text.length > 64) return "64 characters at most"
      return undefined
    default:
      return undefined
  }
}

/** Advance one step. Invalid input keeps the step and attaches the reason. */
export function submitStep(pair: Pair, value: string): Pair {
  const problem = validate(pair, value)
  if (problem) return { ...pair, error: problem }

  const text = value.trim()
  let draft = pair.draft

  switch (pair.step) {
    case "url":
      draft = { ...draft, baseUrl: text.replace(/\/$/, "") }
      break
    case "email":
      draft = { ...draft, email: text === SKIP_EMAIL ? "" : text }
      break
    case "confirm":
      draft = { ...draft, name: text }
      break
    default:
      break
  }

  const plan = remainingSteps(draft, firstStep(draft))
  const next = plan[plan.indexOf(pair.step) + 1] ?? "waiting"
  return { ...pair, draft, step: next, history: [...pair.history, pair.step], error: undefined }
}

/**
 * Back one step.
 *
 * Walks `history` rather than `ORDER` so a step that was skipped on the way in is skipped
 * on the way out too — otherwise going back from `email` on a machine whose url came from
 * the installer would land on a question it was never asked.
 */
export function backStep(pair: Pair): Pair {
  const previous = pair.history[pair.history.length - 1]
  if (!previous) return pair
  return { ...pair, step: previous, history: pair.history.slice(0, -1), error: undefined }
}
