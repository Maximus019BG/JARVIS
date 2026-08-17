/**
 * Folds synced session rows into what the usage page renders. Pure and separate from the
 * page so the day bucketing — the part with edges to get wrong — can be tested without a
 * database or a renderer.
 */

/** `YYYY-MM-DD`, the same key the TUI's metrics rollup buckets on. */
export const dayKey = (at: Date): string => at.toLocaleDateString("en-CA");

export type UsageRow = {
  costMicros: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: Date;
  workstationId: string;
  workstationName: string;
};

export type DayBucket = { key: string; cost: number; sessions: number };
export type WorkstationBucket = { name: string; cost: number; sessions: number };

export type Usage = {
  totals: { cost: number; turns: number; tokens: number };
  /** Ascending, one entry per day in the window including days with no traffic. */
  days: DayBucket[];
  busiestDay: number;
  byWorkstation: WorkstationBucket[];
};

/**
 * `from` is the midnight the window opens on, and `windowDays` counts it — so 30 days means
 * 30 columns ending today, not 31.
 */
export function foldUsage(rows: UsageRow[], from: Date, windowDays: number): Usage {
  const totals = rows.reduce(
    (sum, row) => ({
      cost: sum.cost + row.costMicros,
      turns: sum.turns + row.turns,
      tokens: sum.tokens + row.inputTokens + row.outputTokens,
    }),
    { cost: 0, turns: 0, tokens: 0 },
  );

  // Bucket once, so this is a pass over the rows rather than a scan of them per day.
  const perDay = new Map<string, DayBucket>();
  for (const row of rows) {
    const key = dayKey(row.startedAt);
    const bucket = perDay.get(key) ?? { key, cost: 0, sessions: 0 };
    bucket.cost += row.costMicros;
    bucket.sessions += 1;
    perDay.set(key, bucket);
  }

  // Every day in the window, including the ones with no traffic: a quiet day has to read as
  // quiet rather than be dropped so the chart implies continuous use.
  const days = Array.from({ length: windowDays }, (_, index) => {
    const at = new Date(from);
    at.setDate(at.getDate() + index);
    const key = dayKey(at);
    return perDay.get(key) ?? { key, cost: 0, sessions: 0 };
  });

  const workstations = new Map<string, WorkstationBucket>();
  for (const row of rows) {
    const bucket = workstations.get(row.workstationId) ?? { name: row.workstationName, cost: 0, sessions: 0 };
    bucket.cost += row.costMicros;
    bucket.sessions += 1;
    workstations.set(row.workstationId, bucket);
  }

  return {
    totals,
    days,
    busiestDay: days.reduce((max, day) => Math.max(max, day.cost), 0),
    byWorkstation: [...workstations.values()].sort((a, b) => b.cost - a.cost),
  };
}
