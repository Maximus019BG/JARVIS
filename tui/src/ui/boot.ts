import type { Config } from "../config/config.ts"
import type { Extensions } from "../extend/extensions.ts"
import type { McpStatus } from "../extend/mcp.ts"
import { readCredentials } from "../blueprint/credentials.ts"
import { listSessions, type SessionHeader } from "../agent/session.ts"
import { canSpeak } from "./speak.ts"
import { describeVoice } from "./speak-command.ts"
import { missingWakeModels } from "../voice/wake-models.ts"
import { loadVoices } from "../voice/speaker.ts"

/**
 * One line of the startup report. `tone` is advisory — the renderer maps it onto the theme,
 * so a row can say "this is degraded" without knowing what colour that is here.
 */
export type BootRow = { label: string; value: string; tone: "ok" | "warn" | "off" }

/** Everything the report is derived from, gathered once so the formatter stays pure. */
export type BootFacts = {
  /** The paired cloud, when this device has one. */
  link?: { name?: string; baseUrl: string }
  extensions: Extensions
  mcp: McpStatus[]
  /** The most recent finished session in this directory, excluding the live one. */
  previous?: SessionHeader
  voiceModel?: string
  /** How replies will be read out, or absent when they will not be. */
  speaks?: string
  /** The wake phrase being listened for, or absent when nothing is listening. */
  wake?: string
  /** Names enrolled for speaker identification, when the gate is on. */
  enrolled?: string[]
  now?: number
}

/** A duration in one token — `4m ago`, `3h ago`, `2d ago`. The report has no room for more. */
export function since(from: number, now = Date.now()): string {
  // Thresholded on the raw elapsed time and only then rounded. Rounding first makes thirty
  // seconds "1m ago", and a clock a few seconds ahead of the file "-0m ago".
  const elapsed = Math.max(0, now - from)
  if (elapsed < 60_000) return "just now"
  const minutes = Math.round(elapsed / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** The host of a cloud URL, or the URL itself when it will not parse. Display only. */
function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/**
 * The startup sweep, as rows. Pure: every fact is passed in, so the whole report can be
 * asserted in a test without a paired device, a session directory or an MCP server.
 *
 * Deliberately short. This sits above the prompt on a fresh session and its job is to be
 * read at a glance — four rows that say whether the machine is wired up, not a status page.
 */
export function bootReport(facts: BootFacts): BootRow[] {
  const now = facts.now ?? Date.now()
  const rows: BootRow[] = []

  rows.push(
    facts.link
      ? { label: "link", value: [facts.link.name, host(facts.link.baseUrl)].filter(Boolean).join(" · "), tone: "ok" }
      : { label: "link", value: "standalone", tone: "off" },
  )

  const servers = facts.mcp.filter((status) => !status.error)
  const failed = facts.mcp.length - servers.length
  const capability = [
    `${Object.keys(facts.extensions.tools).length + servers.reduce((sum, s) => sum + s.tools, 0)} tools`,
    `${facts.extensions.skills.length} skills`,
    servers.length > 0 && `${servers.length} mcp`,
  ].filter((part): part is string => Boolean(part))
  // A failed server or a broken plugin is the one thing in this block worth a colour: the
  // counts are reassurance, and reassurance printed over a load error is worse than nothing.
  const broken = failed + facts.extensions.errors.length
  rows.push({
    label: "loaded",
    value: capability.join(" · ") + (broken > 0 ? `  (${broken} failed)` : ""),
    tone: broken > 0 ? "warn" : "ok",
  })

  // One row for both directions of audio, because "voice" is one thing to the person reading
  // it: `in` is what hears them, `out` is what answers.
  const voice = [
    facts.wake && `wake "${facts.wake}"`,
    facts.voiceModel && `in ${facts.voiceModel}`,
    facts.speaks && `out ${facts.speaks}`,
  ].filter((part): part is string => Boolean(part))
  rows.push(
    voice.length > 0
      ? { label: "voice", value: voice.join(" · "), tone: "ok" }
      : { label: "voice", value: "off", tone: "off" },
  )

  // Its own row rather than a fourth clause on the voice line: this one decides whether the
  // agent listens to a person at all, and it should not read as a detail of the microphone.
  if (facts.enrolled) {
    rows.push(
      facts.enrolled.length > 0
        ? { label: "voices", value: facts.enrolled.join(", "), tone: "ok" }
        : { label: "voices", value: "gate on, nobody enrolled — jarvis voice enrol <name>", tone: "warn" },
    )
  }

  if (facts.previous?.title) {
    rows.push({ label: "last", value: `${facts.previous.title} · ${since(facts.previous.created, now)}`, tone: "ok" })
  }

  return rows
}

/**
 * The IO half: reads the credentials file and the session index. Never throws — a report is
 * decoration on the way to a prompt, and a corrupt credentials file should not be the reason
 * a terminal fails to open. Anything unreadable simply drops out of the report.
 */
export function collectBoot(
  config: Config,
  cwd: string,
  extensions: Extensions,
  mcp: McpStatus[],
  liveSessionID: string,
): BootFacts {
  let link: BootFacts["link"]
  try {
    const credentials = readCredentials()
    if (credentials) link = { name: credentials.name, baseUrl: credentials.baseUrl }
  } catch {
    // Corrupt or unreadable: reported as "standalone", which is what it is until repaired.
  }

  let previous: SessionHeader | undefined
  try {
    previous = listSessions(cwd).find((entry) => entry.id !== liveSessionID)
  } catch {
    // No session directory yet, on a first run.
  }

  return {
    link,
    extensions,
    mcp,
    previous,
    voiceModel: config.voice?.model,
    speaks: config.voice?.speak && canSpeak(config) ? describeVoice(config) : undefined,
    // Reported only when it will actually run. "wake on" next to three missing models is the
    // kind of status line that costs somebody an afternoon.
    wake:
      config.voice?.wake?.enabled && missingWakeModels(config.voice.wake.phrase).length === 0
        ? config.voice.wake.phrase
        : undefined,
    enrolled: config.voice?.speaker?.enabled ? enrolledNames() : undefined,
  }
}

/** Never throws: a corrupt voice store is a warning in the report, not a refusal to start. */
function enrolledNames(): string[] {
  try {
    return loadVoices().speakers.map((speaker) => speaker.name)
  } catch {
    return []
  }
}
