import { isTimeZone, matches, minuteStart, parseCron, parseField, partsIn } from "~/lib/automations/cron";

const at = (expression: string) => parseCron(expression)!;
const on = (parts: Partial<Parameters<typeof matches>[1]>) => ({
  minute: 0,
  hour: 0,
  day: 1,
  month: 1,
  weekday: 0,
  ...parts,
});

describe("parseField", () => {
  it("expands a wildcard across the whole range", () => {
    expect(parseField("*", 0, 5)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("expands ranges, lists and steps", () => {
    expect(parseField("1-3", 0, 59)).toEqual(new Set([1, 2, 3]));
    expect(parseField("1,5,9", 0, 59)).toEqual(new Set([1, 5, 9]));
    expect(parseField("*/15", 0, 59)).toEqual(new Set([0, 15, 30, 45]));
    expect(parseField("10-20/5", 0, 59)).toEqual(new Set([10, 15, 20]));
  });

  it("runs a bare value with a step to the end of the range, as Vixie cron does", () => {
    expect(parseField("5/10", 0, 59)).toEqual(new Set([5, 15, 25, 35, 45, 55]));
  });

  it("rejects anything malformed rather than silently matching nothing", () => {
    for (const bad of ["", "x", "1-", "-1", "5-1", "1..3", "*/0", "*/x", "60", "1,,2", "1/"]) {
      expect(parseField(bad, 0, 59)).toBeNull();
    }
  });

  it("rejects values outside the field's own range", () => {
    expect(parseField("32", 1, 31)).toBeNull();
    expect(parseField("0", 1, 31)).toBeNull();
  });
});

describe("parseCron", () => {
  it("needs exactly five fields", () => {
    expect(parseCron("* * * *")).toBeNull();
    expect(parseCron("* * * * * *")).toBeNull();
    expect(parseCron("* * * * *")).not.toBeNull();
  });

  it("tolerates surrounding and repeated whitespace", () => {
    expect(parseCron("  0   9  *  *  1  ")).not.toBeNull();
  });

  it("treats weekday 7 as Sunday", () => {
    expect(at("* * * * 7").weekday).toEqual(new Set([0]));
  });

  it("records which of day-of-month and day-of-week were restricted", () => {
    const both = at("0 0 13 * 5");
    expect(both.dayRestricted).toBe(true);
    expect(both.weekdayRestricted).toBe(true);
    const neither = at("0 0 * * *");
    expect(neither.dayRestricted).toBe(false);
    expect(neither.weekdayRestricted).toBe(false);
  });

  it("rejects an invalid expression", () => {
    expect(parseCron("0 0 * * 9")).toBeNull();
    expect(parseCron("nonsense")).toBeNull();
  });
});

describe("matches", () => {
  it("fires every minute for the all-wildcards expression", () => {
    expect(matches(at("* * * * *"), on({ minute: 37, hour: 13 }))).toBe(true);
  });

  it("respects minute and hour", () => {
    const nineAm = at("0 9 * * *");
    expect(matches(nineAm, on({ minute: 0, hour: 9 }))).toBe(true);
    expect(matches(nineAm, on({ minute: 1, hour: 9 }))).toBe(false);
    expect(matches(nineAm, on({ minute: 0, hour: 10 }))).toBe(false);
  });

  it("ORs day-of-month with day-of-week when both are restricted", () => {
    // "the 13th, and also every Friday" — not "Friday the 13th".
    const cron = at("0 0 13 * 5");
    expect(matches(cron, on({ day: 13, weekday: 2 }))).toBe(true);
    expect(matches(cron, on({ day: 6, weekday: 5 }))).toBe(true);
    expect(matches(cron, on({ day: 6, weekday: 2 }))).toBe(false);
  });

  it("ANDs them when only one is restricted", () => {
    const firstOfMonth = at("0 0 1 * *");
    expect(matches(firstOfMonth, on({ day: 1, weekday: 3 }))).toBe(true);
    expect(matches(firstOfMonth, on({ day: 2, weekday: 3 }))).toBe(false);

    const mondays = at("0 0 * * 1");
    expect(matches(mondays, on({ day: 17, weekday: 1 }))).toBe(true);
    expect(matches(mondays, on({ day: 17, weekday: 2 }))).toBe(false);
  });

  it("respects the month", () => {
    const january = at("0 0 * 1 *");
    expect(matches(january, on({ month: 1 }))).toBe(true);
    expect(matches(january, on({ month: 2 }))).toBe(false);
  });
});

describe("partsIn", () => {
  it("reads wall-clock fields in the requested zone", () => {
    // 2026-08-13T09:30:00Z is a Thursday; Europe/Sofia is UTC+3 in August.
    const parts = partsIn(new Date("2026-08-13T09:30:00Z"), "Europe/Sofia");
    expect(parts).toEqual({ minute: 30, hour: 12, day: 13, month: 8, weekday: 4 });
  });

  it("puts two zones on different days for the same instant", () => {
    const instant = new Date("2026-08-13T23:30:00Z");
    expect(partsIn(instant, "UTC").day).toBe(13);
    expect(partsIn(instant, "Europe/Sofia").day).toBe(14);
  });

  it("renders midnight as hour 0, not 24", () => {
    expect(partsIn(new Date("2026-08-13T00:00:00Z"), "UTC").hour).toBe(0);
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // Same clock time in UTC, one in CET and one in CEST.
    expect(partsIn(new Date("2026-01-15T12:00:00Z"), "Europe/Sofia").hour).toBe(14);
    expect(partsIn(new Date("2026-07-15T12:00:00Z"), "Europe/Sofia").hour).toBe(15);
  });
});

describe("isTimeZone", () => {
  it("accepts real zones and refuses invented ones", () => {
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Europe/Sofia")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("minuteStart", () => {
  it("truncates to the minute, which is the granularity a cron fires at", () => {
    expect(minuteStart(new Date("2026-08-13T09:30:45.123Z")).toISOString()).toBe("2026-08-13T09:30:00.000Z");
  });

  it("is idempotent", () => {
    const once = minuteStart(new Date("2026-08-13T09:30:45Z"));
    expect(minuteStart(once)).toEqual(once);
  });
});
