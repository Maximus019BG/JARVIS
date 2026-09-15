import * as SecureStore from "expo-secure-store"

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const BASE_KEY = "jarvis.baseUrl"
const TOKEN_KEY = "jarvis.token"

/**
 * The session token, in the keychain rather than in `AsyncStorage`.
 *
 * It is the same session token the browser holds in a cookie: whoever has it is signed in as
 * you until it expires or is revoked. On a device that can be picked up off a bench, that
 * belongs behind the platform's own encryption.
 */
let token: string | undefined
let baseUrl: string | undefined

export async function loadSession(): Promise<{ baseUrl?: string; signedIn: boolean }> {
  baseUrl = (await SecureStore.getItemAsync(BASE_KEY)) ?? undefined
  token = (await SecureStore.getItemAsync(TOKEN_KEY)) ?? undefined
  return { baseUrl, signedIn: Boolean(token) }
}

export function currentBaseUrl(): string | undefined {
  return baseUrl
}

export async function setBaseUrl(url: string): Promise<void> {
  baseUrl = url.trim().replace(/\/+$/, "")
  await SecureStore.setItemAsync(BASE_KEY, baseUrl)
}

export async function signOut(): Promise<void> {
  token = undefined
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

async function keep(response: Response): Promise<void> {
  // better-auth's bearer plugin returns the session token in this header on every call that
  // establishes or upgrades a session — sign-in, and the second factor after it. Capturing it
  // from any response is what makes the two-step login work without a cookie jar.
  const issued = response.headers.get("set-auth-token")
  if (!issued) return
  token = issued
  await SecureStore.setItemAsync(TOKEN_KEY, issued)
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  if (!baseUrl) throw new ApiError("no JARVIS address configured", 0)
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")
  if (token) headers.set("authorization", `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers })
  } catch (error) {
    // A phone loses its network constantly. "Failed to fetch" tells nobody anything.
    throw new ApiError(`could not reach ${baseUrl} — ${error instanceof Error ? error.message : "no route"}`, 0)
  }
  await keep(response)
  return response
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await call(path, init)
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail =
      typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : ""
    throw new ApiError(detail || `${response.status} ${response.statusText}`, response.status)
  }
  return body as T
}

export type SignInResult = { needsTwoFactor: boolean }

/**
 * Email and password only.
 *
 * The web app also offers GitHub and Google, and both would work here through a deep link —
 * but an OAuth round trip needs the scheme registered on a build installed on a real device,
 * which is not something this can be shipped without testing. One working path beats three
 * that have never been run.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const body = await json<{ twoFactorRedirect?: boolean }>("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  return { needsTwoFactor: body.twoFactorRedirect === true }
}

export async function verifyTotp(code: string): Promise<void> {
  await json("/api/auth/two-factor/verify-totp", { method: "POST", body: JSON.stringify({ code }) })
}

export type Session = {
  id: string
  title: string
  cwd: string
  workstation: string | null
  idleMs: number
  fresh: boolean
  /** The queue is full: sending would be refused, so do not offer the microphone. */
  full: boolean
  queued: number
}

export const listSessions = () => json<{ sessions: Session[] }>("/api/session").then((body) => body.sessions)

export const sendPrompt = (sessionId: string, prompt: string) =>
  json<{ id: string }>(`/api/session/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ prompt }) })

export type Approval = {
  id: string
  tool: string
  title: string
  detail?: string
  detailKind?: "diff" | "text"
  deviceName: string | null
  expiresAt: string
}

export const listApprovals = () =>
  json<{ approvals: Approval[] }>("/api/approval").then((body) => body.approvals)

export const answerApproval = (id: string, answer: "once" | "reject") =>
  json(`/api/approval/${id}/answer`, { method: "POST", body: JSON.stringify({ answer }) })

export const registerPush = (expoToken: string) =>
  json("/api/mobile/notifications", { method: "PUT", body: JSON.stringify({ expoToken }) })

/** `4m` / `2h` / `3d`, for a list where every row carries one. */
export function idle(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}
