import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { hostname, platform, arch } from "node:os"

/**
 * The RFC 8628 device authorization grant, with no opinion about how it is displayed.
 *
 * Two front ends drive this: `jarvis pair`, which prints, and the `/pair` wizard, which
 * renders. Keeping the protocol here means the retry rules — which of the error codes are
 * "keep going" and which are terminal — exist once, where a mistake in them is one bug
 * rather than two that drift apart.
 */

/**
 * Stable per-machine identifier, shown on the approval screen so the person clicking
 * Approve can tell their own Pi from someone else's box that guessed a code. Hashed
 * because the raw machine-id is a fingerprint we have no reason to hand to the server.
 */
export function fingerprint(): string {
  const sources = ["/etc/machine-id", "/var/lib/dbus/machine-id"]
  const machineId = sources.find((path) => existsSync(path))
  const seed = machineId ? readFileSync(machineId, "utf8").trim() : hostname()
  return createHash("sha256").update(`${seed}:${hostname()}`).digest("hex").slice(0, 12)
}

export const platformLabel = (): string => `${platform()}-${arch()} · ${hostname()}`

export const defaultDeviceName = (): string => hostname()

export type CodeResponse = {
  userCode: string
  deviceCode: string
  verificationUri: string
  verificationUriComplete: string
  /** Terminal-renderable QR of `verificationUriComplete`. Absent on older servers. */
  qr?: string
  expiresIn: number
  interval: number
}

export type Paired = { deviceId: string; token: string; workstationId: string; name: string }

export const normaliseBaseUrl = (url: string): string => url.trim().replace(/\/$/, "")

/** Step one: ask to pair. Nothing is granted until a human approves. */
export async function requestCode(
  baseUrl: string,
  body: { name: string; email?: string },
): Promise<CodeResponse> {
  const response = await fetch(`${normaliseBaseUrl(baseUrl)}/api/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: body.name,
      fingerprint: fingerprint(),
      platform: platformLabel(),
      ...(body.email ? { email: body.email } : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(`could not start pairing (${response.status}) — is ${baseUrl} the right address?`)
  }
  return (await response.json()) as CodeResponse
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new PairCancelled())
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new PairCancelled())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })

/** Thrown when the caller aborts. Distinct from a failure so a UI can close quietly. */
export class PairCancelled extends Error {
  constructor() {
    super("pairing cancelled")
    this.name = "PairCancelled"
  }
}

export type PollOptions = {
  /** Called before each sleep with the seconds left, so a UI can count down. */
  onTick?: (secondsLeft: number) => void
  signal?: AbortSignal
  /** Test seam: injected clock and fetch so the loop can be driven without real time. */
  now?: () => number
}

/**
 * Step two: poll until a human approves, then take delivery of the token.
 *
 * RFC 8628 semantics, and the reason this is a loop rather than one request: `slow_down`
 * means back off and keep going, `authorization_pending` means keep going unchanged, and
 * everything else is final. Treating any of the three as the others either hammers the
 * server or gives up on a pairing that was about to succeed.
 */
export async function pollForToken(
  baseUrl: string,
  code: CodeResponse,
  options: PollOptions = {},
): Promise<Paired> {
  const base = normaliseBaseUrl(baseUrl)
  const now = options.now ?? Date.now
  const deadline = now() + code.expiresIn * 1000
  let interval = code.interval * 1000

  while (now() < deadline) {
    options.onTick?.(Math.max(0, Math.round((deadline - now()) / 1000)))
    await sleep(interval, options.signal)

    const polled = await fetch(`${base}/api/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: code.deviceCode }),
    })
    const body = (await polled.json()) as Partial<Paired> & { error?: string }

    if (polled.ok && body.token && body.deviceId && body.workstationId) {
      return {
        deviceId: body.deviceId,
        token: body.token,
        workstationId: body.workstationId,
        name: body.name ?? "",
      }
    }

    if (body.error === "slow_down") {
      interval += 5000
      continue
    }
    if (body.error === "authorization_pending") continue
    throw new Error(
      body.error === "access_denied"
        ? "pairing was denied or already used"
        : `pairing failed: ${body.error ?? polled.status}`,
    )
  }

  throw new Error("the pairing code expired — start again")
}

/**
 * Read `jarvis pair` arguments by shape rather than by position.
 *
 * `jarvis pair <url>` already shipped, so position cannot mean "email" now without
 * breaking it. A value containing `@` is an address and one starting with `http` is a
 * server, which covers every ordering anyone would reasonably type and leaves the old
 * form working untouched.
 */
export function pairArgs(args: string[]): { baseUrl?: string; email?: string } {
  const out: { baseUrl?: string; email?: string } = {}
  for (const arg of args) {
    if (!arg) continue
    if (arg.includes("@") && !arg.startsWith("http")) out.email ??= arg
    else if (/^https?:\/\//.test(arg)) out.baseUrl ??= arg
  }
  return out
}
