import { readCredentials } from "../blueprint/credentials.ts"

/**
 * Deliberately not shared with `remote-approval.ts`'s `call`: that one is module-private
 * there for the same reason this one is here — importing across these files to save ten
 * lines would drag one poller's dependencies into the other's.
 */
async function call(
  baseUrl: string,
  token: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(`POST ${path} failed: ${response.status}`)
  return await response.json()
}

/**
 * Takes the next prompt somebody queued for this session in the web app, or `undefined` when
 * there is nothing waiting — which is the answer to almost every call.
 *
 * `undefined` for every non-answer, including an unpaired machine and a network failure, so
 * the caller has one thing to check and a blip costs a missed poll rather than a message on
 * screen every few seconds.
 *
 * The server hands each prompt out at most once, so a prompt returned here is spent: if the
 * caller drops it, it is gone rather than replayed into a later turn.
 */
export async function claimPrompt(
  sessionID: string,
  signal?: AbortSignal,
  /** Explicit only in tests; the default reaches the real paired device's token. */
  credentialsPath?: string,
): Promise<string | undefined> {
  const credentials = readCredentials(credentialsPath)
  if (!credentials) return undefined

  try {
    const claimed = (await call(
      credentials.baseUrl,
      credentials.token,
      "/api/device/prompt/claim",
      { sessionId: sessionID },
      signal,
    )) as { prompt?: { prompt?: unknown } | null }
    const prompt = claimed.prompt?.prompt
    // A blank prompt would start a turn with nothing in it. The route rejects empty strings,
    // so this only guards against a server that changed its mind about the shape.
    return typeof prompt === "string" && prompt.trim() ? prompt : undefined
  } catch {
    return undefined
  }
}
