import { readCredentials } from "../blueprint/credentials.ts"
import type { PermissionAnswer, PermissionRequest } from "../permission.ts"

/**
 * Fallbacks for a server that does not advertise its own pace. Nothing auto-answers when
 * the deadline runs out — polling just stops and the terminal prompt stands.
 */
const DEADLINE_MS = 5 * 60 * 1000
const INTERVAL_MS = 3_000
/** A server answering `interval: 0` must not turn the poll into a busy loop. */
const MIN_INTERVAL_MS = 10
/** A diff of a large file would otherwise be rejected by the route's own cap. */
const DETAIL_LIMIT = 4000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Deliberately not `blueprint/sync.ts`'s `call`: that helper is module-private there, and
 * importing the module drags in the git-backed blueprint store for the sake of ten lines.
 */
async function call(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status}`)
  return await response.json()
}

/**
 * Mirrors one permission prompt to the paired cloud and waits for a human to answer it
 * there. Resolves `undefined` for every outcome that is not an answer — unpaired, network
 * trouble, the deadline — so the caller falls back to the terminal prompt. It never
 * decides on the user's behalf in either direction.
 */
export async function remoteAnswer(
  request: PermissionRequest,
  signal: AbortSignal,
  note: (text: string, level?: "info" | "error") => void,
  /** Explicit only in tests: the default reaches the real paired device's token. */
  credentialsPath?: string,
): Promise<PermissionAnswer | undefined> {
  const credentials = readCredentials(credentialsPath)
  if (!credentials) return undefined
  const { baseUrl, token } = credentials

  let id: string
  // The server owns the pace: it knows its own TTL and how much polling it wants.
  let intervalMs = INTERVAL_MS
  let deadlineMs = DEADLINE_MS
  try {
    const created = (await call(
      baseUrl,
      token,
      "POST",
      "/api/approval",
      {
        tool: request.tool,
        title: request.title,
        detail: request.detail?.slice(0, DETAIL_LIMIT),
        detailKind: request.detailKind,
        subject: request.subject,
      },
      signal,
    )) as { id?: string; interval?: number; expiresIn?: number }
    if (!created.id) throw new Error("no approval id in the response")
    id = created.id
    if (created.interval) intervalMs = Math.max(created.interval * 1000, MIN_INTERVAL_MS)
    if (created.expiresIn) deadlineMs = created.expiresIn * 1000
  } catch (error) {
    if (signal.aborted) return undefined
    note(`could not ask your other devices: ${error instanceof Error ? error.message : String(error)}`, "error")
    return undefined
  }

  const deadline = Date.now() + deadlineMs
  try {
    note(`also asking on ${new URL(baseUrl).host} — answer here or there`)
    while (Date.now() < deadline) {
      await sleep(intervalMs)
      if (signal.aborted) return undefined
      let polled: { answer?: string | null; expired?: boolean }
      try {
        polled = (await call(baseUrl, token, "GET", `/api/approval/${id}`, undefined, signal)) as typeof polled
      } catch {
        // A blip mid-run is not worth a message on every tick; keep polling until the
        // deadline and let the terminal prompt stand as the answer of record.
        continue
      }
      if (polled.answer === "once" || polled.answer === "reject") return polled.answer
      // `cancelled` can only come from this process, and `expired` means the server has
      // stopped accepting answers — either way there is nothing left to wait for.
      if (polled.answer || polled.expired) return undefined
    }
    return undefined
  } finally {
    // Always, and deliberately without `signal`: the abort case is the terminal having
    // answered, which is precisely when the row needs taking off the phone. A no-op if
    // somebody already answered remotely.
    void call(baseUrl, token, "DELETE", `/api/approval/${id}`).catch(() => {})
  }
}
