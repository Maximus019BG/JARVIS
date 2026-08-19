import { createInterface } from "node:readline/promises"
import { rmSync } from "node:fs"
import { credentialsPath, readCredentials, writeCredentials } from "../blueprint/credentials.ts"
import {
  defaultDeviceName,
  fingerprint,
  normaliseBaseUrl,
  pollForToken,
  requestCode,
  type CodeResponse,
} from "./pair-flow.ts"

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

async function ask(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`${question} [${fallback}] `)).trim()
    return answer || fallback
  } finally {
    rl.close()
  }
}

/**
 * Headless pairing. The interactive path is `/pair` inside the TUI; this exists for a Pi
 * being set up over SSH, and for scripts.
 */
export async function pair(options: {
  baseUrl?: string
  configCloud?: string
  name?: string
  email?: string
}): Promise<void> {
  const existing = readCredentials()
  if (existing) {
    process.stdout.write(
      `this device is already paired to ${existing.baseUrl} as ${existing.deviceId}\n` +
        "run `jarvis unpair` to pair it somewhere else\n",
    )
    return
  }

  // Not defaulting silently to localhost: on a Pi that is always wrong, and the failure it
  // produces ("could not start pairing") points at the server rather than at the address.
  // Argument, then environment, then config, then ask. Same order the `/pair` wizard uses:
  // the more specific and more temporary a source is, the more it outranks.
  const given = options.baseUrl ?? process.env.JARVIS_CLOUD_URL ?? options.configCloud
  const baseUrl = normaliseBaseUrl(given ?? (await ask("where is your JARVIS?", "http://localhost:3000")))
  const name = options.name ?? defaultDeviceName()

  const code: CodeResponse = await requestCode(baseUrl, { name, email: options.email })

  process.stdout.write(`pairing "${name}" (${fingerprint()})\n`)
  if (code.qr) process.stdout.write(`${code.qr}\n`)
  process.stdout.write(banner(code.userCode, code.verificationUriComplete))
  if (options.email) {
    process.stdout.write(`or approve it in the Devices tab as ${options.email}\n`)
  }
  process.stdout.write("waiting for approval… (ctrl+c to stop)\n")

  const paired = await pollForToken(baseUrl, code)
  writeCredentials({
    baseUrl,
    deviceId: paired.deviceId,
    token: paired.token,
    workstationId: paired.workstationId,
    name: paired.name || name,
  })
  process.stdout.write(`\npaired as ${paired.deviceId}\ncredentials written to ${credentialsPath} (mode 600)\n`)
}

/**
 * Forget the pairing on this machine.
 *
 * Local only, deliberately: the credential that matters is the server's copy, and killing
 * that is `Revoke` in the web app, which also leaves the record of the device having
 * existed. Silently revoking from here would destroy that trail from the least
 * authenticated end. So this says plainly that the token is still live.
 */
export function unpair(options: { yes?: boolean } = {}): void {
  const credentials = readCredentials()
  if (!credentials) {
    process.stdout.write("not paired — nothing to undo\n")
    return
  }
  if (!options.yes) {
    process.stdout.write(
      `this will forget ${credentials.deviceId} on this machine.\n` +
        "run `jarvis unpair -y` to confirm.\n",
    )
    return
  }
  rmSync(credentialsPath, { force: true })
  process.stdout.write(
    [
      `unpaired ${credentials.deviceId} — ${credentialsPath} removed`,
      "",
      "its token is still valid on the server. Revoke it under Settings → Devices at",
      `  ${credentials.baseUrl}/app/settings`,
      "",
    ].join("\n"),
  )
}

export function showDevice(): void {
  const credentials = readCredentials()
  if (!credentials) {
    process.stdout.write("not paired — run `jarvis pair`, or /pair inside jarvis\n")
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
