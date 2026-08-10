import { describe, expect, test } from "bun:test"
import { bar, groupBy, rollup, type MetricRecord } from "../src/agent/metrics.ts"

/** Local midnight `offset` days before `now`, plus `hours` — records land on a known day. */
function at(now: number, offset: number, hours = 12): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - offset)
  date.setHours(hours)
  return date.getTime()
}

const ok = (entry: Partial<MetricRecord> & { at: number; provider: string }): MetricRecord => ({
  ms: 1000,
  model: "m",
  input: 100,
  output: 50,
  cost: 0.01,
  ...entry,
})

describe("rollup", () => {
  // A fixed instant so the day arithmetic is not at the mercy of when the suite runs.
  const now = new Date(2026, 6, 31, 15, 0, 0).getTime()

  test("totals, failures and success rate are per provider", () => {
    const rolls = rollup(
      [
        ok({ at: at(now, 0), provider: "anthropic", cost: 1 }),
        ok({ at: at(now, 0, 13), provider: "anthropic", cost: 2, error: "overloaded" }),
        ok({ at: at(now, 1), provider: "openai", cost: 0.5 }),
      ],
      14,
      now,
    )
    expect(rolls.map((roll) => roll.provider)).toEqual(["anthropic", "openai"])
    const anthropic = rolls[0]!
    expect(anthropic.turns).toBe(2)
    expect(anthropic.failures).toBe(1)
    expect(anthropic.cost).toBe(3)
    expect(anthropic.input).toBe(200)
    expect(anthropic.lastError?.message).toBe("overloaded")
    expect(rolls[1]!.turns).toBe(1)
  })

  test("newest use sorts first, not the busiest", () => {
    const rolls = rollup(
      [
        ok({ at: at(now, 5), provider: "busy" }),
        ok({ at: at(now, 5, 13), provider: "busy" }),
        ok({ at: at(now, 0), provider: "recent" }),
      ],
      14,
      now,
    )
    expect(rolls[0]!.provider).toBe("recent")
  })

  test("the day window includes today and keeps quiet days as zero rows", () => {
    const rolls = rollup([ok({ at: at(now, 0), provider: "p" }), ok({ at: at(now, 2), provider: "p" })], 3, now)
    const days = rolls[0]!.days
    expect(days.map((day) => day.day)).toEqual(["2026-07-29", "2026-07-30", "2026-07-31"])
    expect(days.map((day) => day.turns)).toEqual([1, 0, 1])
  })

  test("records older than the window are excluded entirely", () => {
    expect(rollup([ok({ at: at(now, 30), provider: "p" })], 14, now)).toEqual([])
  })

  test("p50 is the median, so one very slow turn does not move it", () => {
    const rolls = rollup(
      [
        ok({ at: at(now, 0, 9), provider: "p", ms: 1000 }),
        ok({ at: at(now, 0, 10), provider: "p", ms: 2000 }),
        ok({ at: at(now, 0, 11), provider: "p", ms: 240_000 }),
      ],
      14,
      now,
    )
    expect(rolls[0]!.p50ms).toBe(2000)
  })

  test("the worst outage spans a failure run and is closed by the next success", () => {
    const rolls = rollup(
      [
        ok({ at: at(now, 1, 9), provider: "p" }),
        ok({ at: at(now, 1, 10), provider: "p", error: "500" }),
        ok({ at: at(now, 1, 11), provider: "p", error: "500" }),
        ok({ at: at(now, 1, 12), provider: "p", error: "500" }),
        ok({ at: at(now, 1, 13), provider: "p" }),
        // A later, shorter run must not displace the longer one.
        ok({ at: at(now, 0, 9), provider: "p", error: "429" }),
        ok({ at: at(now, 0, 10), provider: "p" }),
      ],
      14,
      now,
    )
    const outage = rolls[0]!.worstOutage!
    expect(outage.failures).toBe(3)
    expect(outage.from).toBe(at(now, 1, 10))
    // Closed by the success at 13:00, not left at the last failure.
    expect(outage.to).toBe(at(now, 1, 13))
  })

  test("no failures means no outage", () => {
    expect(rollup([ok({ at: at(now, 0), provider: "p" })], 14, now)[0]!.worstOutage).toBeUndefined()
  })
})

describe("bar", () => {
  test("the busiest value fills the field and zero reads as absent", () => {
    expect(bar(10, 10, 8)).toBe("████████")
    expect(bar(0, 10, 8)).toBe("–")
    expect(bar(5, 10, 8)).toBe("████")
  })

  test("a nonzero value never renders as nothing", () => {
    // 1 of 1000 over 8 cells rounds to zero full cells; it still has to be visible.
    expect(bar(1, 1000, 8)).not.toBe("")
    expect(bar(1, 1000, 8)).not.toBe("–")
  })

  test("a remainder becomes a partial block rather than being dropped", () => {
    expect(bar(3, 8, 8)).toBe("███")
    expect(bar(7, 16, 8)).toBe("███▌")
  })
})

describe("groupBy", () => {
  const now = new Date(2026, 6, 31, 15, 0, 0).getTime()
  const records: MetricRecord[] = [
    ok({ at: at(now, 0), provider: "anthropic", model: "opus", cost: 1, session: "ses_a", agent: "build" }),
    ok({ at: at(now, 0), provider: "anthropic", model: "opus", cost: 2, session: "ses_b", agent: "plan" }),
    ok({ at: at(now, 1), provider: "openai", model: "gpt", cost: 0.5, session: "ses_a", agent: "build" }),
    // A hard failure: zero tokens, but it still counts as a turn against its agent.
    ok({ at: at(now, 1), provider: "openai", model: "gpt", cost: 0, input: 0, output: 0, error: "boom", session: "ses_a", agent: "build" }),
    // Predates the session/agent fields entirely — must not invent a bucket.
    ok({ at: at(now, 2), provider: "openai", model: "gpt", cost: 4 }),
  ]

  test("folds by model, dearest first", () => {
    const groups = groupBy(records, (entry) => entry.model)
    expect(groups.map((group) => group.key)).toEqual(["gpt", "opus"])
    expect(groups[0]!.cost).toBeCloseTo(4.5)
    expect(groups[0]!.turns).toBe(3)
    expect(groups[0]!.failures).toBe(1)
  })

  test("folds by agent and sums tokens", () => {
    const groups = groupBy(records, (entry) => entry.agent)
    // plan's single $2 turn outranks build's three turns totalling $1.50.
    expect(groups.map((group) => group.key)).toEqual(["plan", "build"])
    const build = groups[1]!
    expect(build.cost).toBeCloseTo(1.5)
    // Three build turns, one of which reported no tokens.
    expect(build.input).toBe(200)
    expect(build.output).toBe(100)
  })

  test("drops records with no key instead of bucketing them together", () => {
    const bySession = groupBy(records, (entry) => entry.session)
    expect(bySession.map((group) => group.key)).toEqual(["ses_b", "ses_a"])
    // The $4 legacy row is absent here, so it cannot masquerade as the top session.
    expect(bySession.reduce((sum, group) => sum + group.cost, 0)).toBeCloseTo(3.5)
  })

  test("is empty for no records", () => {
    expect(groupBy([], (entry) => entry.model)).toEqual([])
  })
})
