import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { hostname, platform, arch } from "node:os"
import { credentialsPath, readCredentials, writeCredentials } from "../blueprint/credentials.ts"

/**
 * Stable per-machine identifier, shown on the approval screen so the person clicking
 * Approve can tell their own Pi from someone else's box that guessed a code. Hashed
 * because the raw machine-id is a fingerprint we have no reason to hand to the server.
 */
function fingerprint(): string {
  const sources = ["/etc/machine-id", "/var/lib/dbus/machine-id"]
  const machineId = sources.find((path) => existsSync(path))
  const seed = machineId ? readFileSync(machineId, "utf8").trim() : hostname()
  return createHash("sha256").update(`${seed}:${hostname()}`).digest("hex").slice(0, 12)
}

const platformLabel = () => `${platform()}-${arch()} · ${hostname()}`

type CodeResponse = {
  userCode: string
  deviceCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

type TokenResponse = { deviceId: string; token: string; workstationId: string; name: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The code, big enough to read off a projected surface across a workshop. */
function banner(code: string, uri: string): string {
  const width = Math.max(code.length, uri.length) + 6
  const line = "─".repeat(width)
  const centre = (text: string) => {
    const pad = Math.floor((width - text.length) / 2)
    return `│${" ".repeat(pad)}${text}${" ".repeat(width - pad - text.length)}│`
  }
  return ["", `┌${line}┐`, centre(""), centre(uri), centre(""), centre(code), centre(""), `└${line}┘`, ""].join("\n")
}

export async function pair(options: { baseUrl?: string; name?: string }): Promise<void> {
  const existing = readCredentials()
  if (existing) {
    process.stdout.write(
      `this device is already paired to ${existing.baseUrl} as ${existing.deviceId}\n` +
        `delete ${credentialsPath} to pair again\n`,
    )
    return
  }

  const baseUrl = (options.baseUrl ?? process.env.JARVIS_CLOUD_URL ?? "http://localhost:3000").replace(/\/$/, "")
  const name = options.name ?? hostname()

  const requested = await fetch(`${baseUrl}/api/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, fingerprint: fingerprint(), platform: platformLabel() }),
  })
  if (!requested.ok) {
    throw new Error(`could not start pairing (${requested.status}) — is ${baseUrl} the right address?`)
  }
  const code = (await requested.json()) as CodeResponse

  process.stdout.write(`pairing "${name}" (${fingerprint()})\n`)
  process.stdout.write(banner(code.userCode, code.verificationUri))
  process.stdout.write("waiting for approval… (ctrl+c to stop)\n")

  const deadline = Date.now() + code.expiresIn * 1000
  let interval = code.interval * 1000

  while (Date.now() < deadline) {
    await sleep(interval)
    const polled = await fetch(`${baseUrl}/api/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: code.deviceCode }),
    })
    const body = (await polled.json()) as Partial<TokenResponse> & { error?: string; interval?: number }

    if (polled.ok && body.token && body.deviceId && body.workstationId) {
      writeCredentials({
        baseUrl,
        deviceId: body.deviceId,
        token: body.token,
        workstationId: body.workstationId,
        name: body.name ?? name,
      })
      process.stdout.write(`\npaired as ${body.deviceId}\ncredentials written to ${credentialsPath} (mode 600)\n`)
      return
    }

    // RFC 8628 semantics: `slow_down` means back off and keep going; the rest are final.
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

  throw new Error("the pairing code expired — run `jarvis pair` again")
}

export function showDevice(): void {
  const credentials = readCredentials()
  if (!credentials) {
    process.stdout.write("not paired — run `jarvis pair`\n")
    return
  }
  process.stdout.write(
    [
      `device      ${credentials.deviceId}`,
      `name        ${credentials.name ?? "—"}`,
      `cloud       ${credentials.baseUrl}`,
      `workstation ${credentials.workstationId}`,
      `token       ${credentials.token.slice(0, 10)}… (stored in ${credentialsPath})`,
      "",
      "manage this device's blueprint access in the web app under Settings → Devices.",
    ].join("\n") + "\n",
  )
}
