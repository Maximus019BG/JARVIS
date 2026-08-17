import { isDue, type CronCandidate } from "~/server/automations/schedule";

/** A trigger that is due at 09:00 UTC on any day, unless a test says otherwise. */
const candidate = (over: Partial<CronCandidate> = {}): CronCandidate => ({
  id: "atr_test",
  automationId: "aut_test",
  config: { expression: "0 9 * * *", tz: "UTC" },
  lastFiredAt: null,
  status: "active",
  publishedVersion: 3,
  ...over,
});

const NINE = new Date("2026-08-13T09:00:00Z");
const NINE_LATER = new Date("2026-08-13T09:00:41Z");
const TEN = new Date("2026-08-13T10:00:00Z");

describe("isDue", () => {
  it("fires on the scheduled minute", () => {
    expect(isDue(candidate(), NINE)).toBe(true);
  });

  it("does not fire on any other minute", () => {
    expect(isDue(candidate(), TEN)).toBe(false);
    expect(isDue(candidate(), new Date("2026-08-13T09:01:00Z"))).toBe(false);
  });

  it("still fires later in the same minute — the poll is every few seconds", () => {
    expect(isDue(candidate(), NINE_LATER)).toBe(true);
  });

  it("fires only once per minute however often it is polled", () => {
    // What the sweep writes after winning the race.
    const fired = candidate({ lastFiredAt: new Date("2026-08-13T09:00:00Z") });
    expect(isDue(fired, NINE)).toBe(false);
    expect(isDue(fired, NINE_LATER)).toBe(false);
  });

  it("fires again the next day", () => {
    const fired = candidate({ lastFiredAt: new Date("2026-08-13T09:00:00Z") });
    expect(isDue(fired, new Date("2026-08-14T09:00:00Z"))).toBe(true);
  });

  it("reads the schedule in the trigger's own timezone", () => {
    const sofia = candidate({ config: { expression: "0 9 * * *", tz: "Europe/Sofia" } });
    // 09:00 in Sofia is 06:00Z in August.
    expect(isDue(sofia, new Date("2026-08-13T06:00:00Z"))).toBe(true);
    expect(isDue(sofia, NINE)).toBe(false);
  });

  it("never fires an automation that is not active", () => {
    expect(isDue(candidate({ status: "draft" }), NINE)).toBe(false);
    expect(isDue(candidate({ status: "paused" }), NINE)).toBe(false);
  });

  it("never fires an automation that was never published", () => {
    expect(isDue(candidate({ publishedVersion: null }), NINE)).toBe(false);
  });

  it("ignores a trigger whose config is missing or malformed", () => {
    expect(isDue(candidate({ config: null }), NINE)).toBe(false);
    expect(isDue(candidate({ config: {} }), NINE)).toBe(false);
    expect(isDue(candidate({ config: { expression: "0 9 * * *" } }), NINE)).toBe(false);
    expect(isDue(candidate({ config: { expression: "not a cron", tz: "UTC" } }), NINE)).toBe(false);
    expect(isDue(candidate({ config: { expression: 5, tz: "UTC" } }), NINE)).toBe(false);
  });

  it("ignores an unknown timezone rather than throwing into the device poll", () => {
    expect(isDue(candidate({ config: { expression: "0 9 * * *", tz: "Mars/Olympus_Mons" } }), NINE)).toBe(false);
  });

  it("supports a schedule that fires every minute", () => {
    const everyMinute = candidate({ config: { expression: "* * * * *", tz: "UTC" } });
    expect(isDue(everyMinute, NINE)).toBe(true);
    expect(isDue(everyMinute, new Date("2026-08-13T09:01:00Z"))).toBe(true);
    // But still only once within one of them.
    expect(isDue({ ...everyMinute, lastFiredAt: new Date("2026-08-13T09:01:00Z") }, new Date("2026-08-13T09:01:30Z"))).toBe(
      false,
    );
  });

  it("supports weekday schedules", () => {
    // 2026-08-13 is a Thursday.
    const thursdays = candidate({ config: { expression: "0 9 * * 4", tz: "UTC" } });
    expect(isDue(thursdays, NINE)).toBe(true);
    const fridays = candidate({ config: { expression: "0 9 * * 5", tz: "UTC" } });
    expect(isDue(fridays, NINE)).toBe(false);
  });
});
