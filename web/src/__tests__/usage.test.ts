import { dayKey, foldUsage, type UsageRow } from "~/lib/usage";

const row = (startedAt: Date, costMicros: number, workstationId = "wst_1"): UsageRow => ({
  startedAt,
  costMicros,
  turns: 2,
  inputTokens: 100,
  outputTokens: 10,
  workstationId,
  workstationName: workstationId === "wst_1" ? "desk" : "laptop",
});

/** Midnight `back` days ago, which is how the page opens its window. */
const midnightDaysAgo = (back: number) => {
  const at = new Date();
  at.setHours(0, 0, 0, 0);
  at.setDate(at.getDate() - back);
  return at;
};

describe("foldUsage", () => {
  it("returns one column per day in the window, oldest first", () => {
    const from = midnightDaysAgo(6);
    const { days } = foldUsage([], from, 7);

    expect(days).toHaveLength(7);
    expect(days[0]!.key).toBe(dayKey(from));
    expect(days.at(-1)!.key).toBe(dayKey(new Date()));
    // The window counts `from` itself, so 7 days ends today rather than tomorrow.
    expect(new Set(days.map((day) => day.key)).size).toBe(7);
  });

  it("keeps quiet days as zero rather than dropping them", () => {
    const from = midnightDaysAgo(2);
    // Traffic only today; the two days before it must still be present.
    const { days } = foldUsage([row(new Date(), 500_000)], from, 3);

    expect(days.map((day) => day.sessions)).toEqual([0, 0, 1]);
    expect(days[0]!.cost).toBe(0);
  });

  it("sums cost and sessions into the right day", () => {
    const from = midnightDaysAgo(1);
    const yesterday = midnightDaysAgo(1);
    const { days, busiestDay, totals } = foldUsage(
      [row(new Date(), 250_000), row(new Date(), 750_000), row(yesterday, 100_000)],
      from,
      2,
    );

    expect(days[0]).toEqual({ key: dayKey(yesterday), cost: 100_000, sessions: 1 });
    expect(days[1]!.cost).toBe(1_000_000);
    expect(busiestDay).toBe(1_000_000);
    expect(totals).toEqual({ cost: 1_100_000, turns: 6, tokens: 330 });
  });

  it("groups by workstation, dearest first", () => {
    const { byWorkstation } = foldUsage(
      [row(new Date(), 100_000, "wst_1"), row(new Date(), 900_000, "wst_2"), row(new Date(), 50_000, "wst_1")],
      midnightDaysAgo(0),
      1,
    );

    expect(byWorkstation).toEqual([
      { name: "laptop", cost: 900_000, sessions: 1 },
      { name: "desk", cost: 150_000, sessions: 2 },
    ]);
  });

  it("has no busiest day when nothing was spent", () => {
    // Guards the chart's divisor: `Math.max(...[])` is -Infinity, which would render as NaN%.
    expect(foldUsage([], midnightDaysAgo(0), 1).busiestDay).toBe(0);
  });
});
