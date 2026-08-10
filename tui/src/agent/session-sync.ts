// Bun-only, like blueprint/sync.ts: reads session files and talks to the cloud.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { readCredentials, type Credentials } from "../blueprint/credentials.ts"
import type { Config } from "../config/config.ts"
import { sessionDir } from "../config/paths.ts"
import { readRecords } from "./metrics.ts"
import { listSessions } from "./session.ts"

/** Matches the route's cap; a transcript past this needs an incremental endpoint. */
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024

const path = (id: string) => join(sessionDir, `${id}.jsonl`)

async function call(credentials: Credentials, method: string, route: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${credentials.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${route} failed: ${response.status}`)
  return await response.json()
}

/** Non-empty JSONL lines, which is what the server stores as its sync cursor. */
export function lineCount(transcript: string): number {
  let count = 0
  for (const line of transcript.split("\n")) if (line.trim()) count += 1
  return count
}

export type SessionTotals = { turns: number; inputTokens: number; outputTokens: number; costMicros: number }

/** Per-session totals from `metrics.jsonl`. Zero for sessions predating session tagging. */
export function metricsFor(id: string, records = readRecords()): SessionTotals {
  const totals: SessionTotals = { turns: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 }
  for (const entry of records) {
    if (entry.session !== id) continue
    totals.turns += 1
    totals.inputTokens += entry.input
    totals.outputTokens += entry.output
    // Rounded once, at the boundary, rather than accumulating float dollars.
    totals.costMicros += Math.round(entry.cost * 1_000_000)
  }
  return totals
}

export type SyncResult = { pushed: string[]; skipped: number }

/**
 * Mirrors every local session the server does not already have in full.
 *
 * Off unless `syncSessions` is set: a transcript carries verbatim file contents, commands,
 * and tool output from whatever repository the agent was pointed at, and pairing a device
 * was consent to sync blueprints, not source.
 */
export async function pushSessions(
  config: Config,
  options: { skip?: string; credentialsPath?: string } = {},
): Promise<SyncResult> {
  const result: SyncResult = { pushed: [], skipped: 0 }
  if (!config.syncSessions) return result

  const credentials = readCredentials(options.credentialsPath)
  if (!credentials) return result

  const remote = new Map<string, number>()
  const listed = (await call(credentials, "GET", "/api/session/list")) as {
    sessions?: { id: string; lines: number }[]
  }
  for (const row of listed.sessions ?? []) remote.set(row.id, row.lines)

  // One read of the metrics file for the whole sweep rather than one per session.
  const records = readRecords()

  for (const header of listSessions()) {
    // The live session is still being appended to; it goes up on the next launch, whole.
    if (header.id === options.skip) continue
    const file = path(header.id)
    if (!existsSync(file)) continue
    const transcript = readFileSync(file, "utf8")
    if (transcript.length > MAX_TRANSCRIPT_BYTES) {
      result.skipped += 1
      continue
    }
    const lines = lineCount(transcript)
    if ((remote.get(header.id) ?? 0) >= lines) continue

    await call(credentials, "POST", "/api/session/push", {
      id: header.id,
      title: header.title,
      cwd: header.cwd,
      startedAt: new Date(header.created).toISOString(),
      lines,
      transcript,
      ...metricsFor(header.id, records),
    })
    result.pushed.push(header.id)
  }

  return result
}
