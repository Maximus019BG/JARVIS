import { bar, groupBy, readRecords, type Group, type MetricRecord } from "../agent/metrics.ts"
import { listSessions } from "../agent/session.ts"
import type { Line, PanelContent } from "./components/panel.tsx"

const DEFAULT_DAYS = 7

const blank: Line = { text: "" }
const head = (text: string): Line => ({ text, tone: "accent" })
const body = (text: string): Line => ({ text })

const thousands = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1000).toFixed(1)}k`)
const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`

/**
 * `name          $1.23  ██████▍  42 turns  10.1k/2.0k`, with the bar scaled to the
 * dearest row so the shape of the spend is readable without doing arithmetic.
 */
function rows(groups: Group[], width: number, label: (key: string) => string): Line[] {
  if (groups.length === 0) return [body("nothing recorded yet")]
  const max = Math.max(...groups.map((group) => group.cost))
  // Name gets whatever the numbers do not need; the bar takes what is left over.
  const nameWidth = Math.max(12, Math.min(28, width - 42))
  const barWidth = Math.max(6, width - nameWidth - 34)
  return groups.map((group) => {
    const name = label(group.key)
    const trimmed = name.length > nameWidth ? `${name.slice(0, nameWidth - 1)}…` : name.padEnd(nameWidth)
    const failures = group.failures > 0 ? ` ${group.failures} failed` : ""
    return body(
      `${trimmed} ${money(group.cost).padStart(8)} ${bar(group.cost, max, barWidth).padEnd(barWidth)} ` +
        `${String(group.turns).padStart(4)} ${group.turns === 1 ? "turn " : "turns"}  ` +
        `${thousands(group.input)}/${thousands(group.output)}${failures}`,
    )
  })
}

function section(title: string, groups: Group[], width: number, label: (key: string) => string = (key) => key): Line[] {
  return [head(title), ...rows(groups, width, label), blank]
}

/**
 * Spend and tokens, by model, agent and session. `/stats [days]`.
 *
 * Reads the same append-only `metrics.jsonl` as `/provider stats`, which answers a
 * different question — that one is "is this provider healthy", this one is "where did the
 * money go".
 */
export function statsCommand(args: string, { width }: { width: number }): PanelContent {
  const requested = Number.parseInt(args.trim(), 10)
  const days = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_DAYS

  // Midnight local, `days - 1` back, so "7 days" includes today — matching `rollup`.
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const records = readRecords(start.getTime())

  if (records.length === 0) {
    return {
      title: `stats · last ${days} day${days === 1 ? "" : "s"}`,
      lines: [body("no turns recorded in this window"), blank, body("/stats 30 to look further back")],
    }
  }

  // Titles are nicer than `ses_m1x…` and cheap to get: listSessions reads only the first
  // line of each file. A session recorded here but since deleted keeps its id.
  const titles = new Map<string, string>()
  try {
    for (const found of listSessions()) titles.set(found.id, found.title)
  } catch {
    // No session directory is a fine state; the ids are still readable.
  }

  const total = records.reduce(
    (sum, entry: MetricRecord) => ({
      turns: sum.turns + 1,
      failures: sum.failures + (entry.error ? 1 : 0),
      input: sum.input + entry.input,
      output: sum.output + entry.output,
      cost: sum.cost + entry.cost,
    }),
    { turns: 0, failures: 0, input: 0, output: 0, cost: 0 },
  )

  const untagged = records.filter((entry) => !entry.session).length

  return {
    title: `stats · last ${days} day${days === 1 ? "" : "s"}`,
    lines: [
      head(
        `${money(total.cost)} over ${total.turns} turn${total.turns === 1 ? "" : "s"} · ${thousands(total.input)} in / ${thousands(total.output)} out` +
          (total.failures > 0 ? ` · ${total.failures} failed` : ""),
      ),
      blank,
      ...section("by model", groupBy(records, (entry) => entry.model), width),
      ...section("by agent", groupBy(records, (entry) => entry.agent), width),
      ...section("by session", groupBy(records, (entry) => entry.session), width, (id) => titles.get(id) ?? id),
      // Otherwise the sections quietly disagree with the total and the reader has to work
      // out why on their own.
      ...(untagged > 0 ? [body(`${untagged} of those predate per-session tracking: counted in the total only`)] : []),
    ],
  }
}
