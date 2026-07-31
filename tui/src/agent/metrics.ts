import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { dataDir } from "../config/paths.ts"
import { parseModelID } from "./provider.ts"

/**
 * One line per turn, append-only, never rewritten — the same shape as a session file minus the
 * header, since there is no per-file identity to record. Written for every turn so that
 * "which provider is costing me money, and which one keeps failing" is answerable at all.
 */
export type MetricRecord = {
  /** Turn start, epoch ms. */
  at: number
  /** Wall clock of the whole turn. */
  ms: number
  provider: string
  model: string
  input: number
  output: number
  cost: number
  /** Absent on success. Present means the turn ended in a provider or agent failure. */
  error?: string
}

const file = join(dataDir, "metrics.jsonl")

/**
 * Records one turn. Never throws: losing a statistic is not worth failing a turn over, and
 * this runs on the success path of every message the user sends.
 *
 * ponytail: no rotation. ~150 bytes a turn is ~11MB a year at a heavy 200 turns/day, and
 * `rollup` only ever looks at a recent window. Add rotation if a file crosses ~100MB.
 */
export function record(entry: MetricRecord): void {
  try {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    appendFileSync(file, `${JSON.stringify(entry)}\n`)
  } catch {
    // a metrics write must never take a turn down with it
  }
}

/** Every record at or after `since`. Unparseable lines are skipped, not fatal. */
export function readRecords(since = 0): MetricRecord[] {
  if (!existsSync(file)) return []
  const out: MetricRecord[] = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue
    try {
      const entry = JSON.parse(line) as MetricRecord
      if (entry.at >= since) out.push(entry)
    } catch {
      // a truncated or hand-edited line should not hide the rest of the history
    }
  }
  return out
}

/** The provider half of a `provider/model` id, for attributing a turn. */
export const providerOf = (modelID: string): string => parseModelID(modelID).providerID

export type DayRoll = { day: string; turns: number; failures: number; tokens: number; cost: number }
/** A run of consecutive failures, as far as observed traffic can see it. */
export type Outage = { from: number; to: number; failures: number }

export type ProviderRoll = {
  provider: string
  turns: number
  failures: number
  input: number
  output: number
  cost: number
  /** Median, not mean: one four-minute agentic turn makes a mean meaningless. */
  p50ms: number
  lastAt: number
  lastError?: { at: number; message: string }
  /** Ascending, one entry per day in the window including days with no traffic. */
  days: DayRoll[]
  worstOutage?: Outage
}

/** `YYYY-MM-DD` in local time — the day boundary the reader actually lives in. */
const dayKey = (at: number) => new Date(at).toLocaleDateString("en-CA")

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * The longest run of consecutive failures, ending at the next success. Observed only: an
 * outage during which nobody sent anything is invisible here, and that is the honest answer —
 * the alternative is polling every provider on a timer and paying for it.
 */
function worstOutage(records: MetricRecord[]): Outage | undefined {
  let worst: Outage | undefined
  let run: Outage | undefined
  for (const entry of records) {
    if (entry.error) {
      run = run
        ? { from: run.from, to: entry.at, failures: run.failures + 1 }
        : { from: entry.at, to: entry.at, failures: 1 }
      if (!worst || run.failures > worst.failures) worst = run
    } else {
      // The success closes the run, so the outage ends here rather than at the last failure.
      if (run) run.to = entry.at
      run = undefined
    }
  }
  return worst
}

/**
 * Folds records into one entry per provider, newest-first by last use. Pure, so the shape of
 * the report can be tested without a renderer or a disk.
 */
export function rollup(records: MetricRecord[], days = 14, now = Date.now()): ProviderRoll[] {
  // Midnight local, `days - 1` days back, so "14 days" includes today rather than 15 columns.
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const from = start.getTime()

  const window = records.filter((entry) => entry.at >= from).sort((a, b) => a.at - b.at)
  const keys: string[] = []
  for (let index = 0; index < days; index++) {
    const at = new Date(from)
    at.setDate(at.getDate() + index)
    keys.push(dayKey(at.getTime()))
  }

  const byProvider = new Map<string, MetricRecord[]>()
  for (const entry of window) {
    const list = byProvider.get(entry.provider)
    if (list) list.push(entry)
    else byProvider.set(entry.provider, [entry])
  }

  const rolls: ProviderRoll[] = []
  for (const [provider, entries] of byProvider) {
    const failures = entries.filter((entry) => entry.error)
    const last = failures[failures.length - 1]
    rolls.push({
      provider,
      turns: entries.length,
      failures: failures.length,
      input: entries.reduce((sum, entry) => sum + entry.input, 0),
      output: entries.reduce((sum, entry) => sum + entry.output, 0),
      cost: entries.reduce((sum, entry) => sum + entry.cost, 0),
      p50ms: median(entries.map((entry) => entry.ms)),
      lastAt: entries[entries.length - 1]!.at,
      lastError: last ? { at: last.at, message: last.error! } : undefined,
      // Zero rows are kept: a quiet day has to read as quiet, not be silently dropped so the
      // chart implies continuous use.
      days: keys.map((day) => {
        const forDay = entries.filter((entry) => dayKey(entry.at) === day)
        return {
          day,
          turns: forDay.length,
          failures: forDay.filter((entry) => entry.error).length,
          tokens: forDay.reduce((sum, entry) => sum + entry.input + entry.output, 0),
          cost: forDay.reduce((sum, entry) => sum + entry.cost, 0),
        }
      }),
      worstOutage: worstOutage(entries),
    })
  }
  return rolls.sort((a, b) => b.lastAt - a.lastAt)
}

const EIGHTHS = [..."▏▎▍▌▋▊▉"]

/** One bar of `width` cells, using an eighth-block for the remainder. Empty reads as `–`. */
export function bar(value: number, max: number, width: number): string {
  if (value <= 0 || max <= 0) return "–"
  const cells = (value / max) * width
  const full = Math.floor(cells)
  const rest = cells - full
  // A day too small to round to even one eighth still has to be visible: a bar that vanishes
  // is indistinguishable from no traffic, which is the one thing it must not say.
  if (full === 0 && rest < 1 / 8) return EIGHTHS[0]!
  return "█".repeat(full) + (rest >= 1 / 8 ? EIGHTHS[Math.min(6, Math.floor(rest * 8) - 1)]! : "")
}
