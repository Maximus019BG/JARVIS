/**
 * Standard 5-field cron, matched against a moment rather than projected forward.
 *
 * The usual hard part of a cron library — computing the next fire time across DST
 * boundaries — is not needed here. The scheduler is the device claim poll, which asks "is
 * anything due right now?" every few seconds, so a predicate over the current minute is the
 * whole requirement. That is a page of code with no dependency, where next-fire projection
 * is where cron libraries earn their keep.
 *
 * The trade is that a schedule whose minute passes with no workstation polling does not fire
 * late — it does not fire at all. That is inherent in tying the scheduler to the heartbeat,
 * and it is the right behaviour here: an `agent` step needs the workstation awake anyway.
 *
 * Field syntax: `*`, `n`, `a-b`, and any of those with a `/step`, comma-separated. Month and
 * weekday names are deliberately not accepted — numbers only, validated strictly at creation
 * so a typo is a 400 rather than a trigger that silently never fires.
 */

export type ParsedCron = {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  /** Whether each of day-of-month / day-of-week was restricted, which changes how they combine. */
  dayRestricted: boolean;
  weekdayRestricted: boolean;
};

export type CronParts = {
  minute: number;
  hour: number;
  /** Day of month, 1-31. */
  day: number;
  /** 1-12, not the 0-11 a `Date` would give. */
  month: number;
  /** 0 = Sunday. */
  weekday: number;
};

/**
 * One field into the set of values it allows, or `null` if it is malformed.
 *
 * `null` rather than a throw because every caller here is validating input and wants to say
 * which field was wrong, not unwind.
 */
export function parseField(field: string, min: number, max: number): Set<number> | null {
  if (field.length === 0) return null;
  const out = new Set<number>();

  for (const part of field.split(",")) {
    const [range, step] = part.split("/");
    if (range === undefined || range.length === 0) return null;
    if (step !== undefined && !/^\d+$/.test(step)) return null;
    const by = step === undefined ? 1 : Number(step);
    if (by < 1) return null;

    let from: number;
    let to: number;
    if (range === "*") {
      from = min;
      to = max;
    } else if (/^\d+-\d+$/.test(range)) {
      const [a, b] = range.split("-").map(Number) as [number, number];
      from = a;
      to = b;
    } else if (/^\d+$/.test(range)) {
      from = Number(range);
      // A bare value with a step runs to the end of the range, as Vixie cron does: `5/10`
      // in the minute field is 5, 15, 25… not just 5.
      to = step === undefined ? from : max;
    } else {
      return null;
    }

    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += by) out.add(value);
  }

  return out.size > 0 ? out : null;
}

/** `null` for anything this does not accept, so the caller can reject it at creation time. */
export function parseCron(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minute = parseField(minuteField, 0, 59);
  const hour = parseField(hourField, 0, 23);
  const day = parseField(dayField, 1, 31);
  const month = parseField(monthField, 1, 12);
  // 7 is Sunday as well as 0, which is what people write and every cron accepts.
  const weekday = parseField(weekdayField, 0, 7);
  if (!minute || !hour || !day || !month || !weekday) return null;

  if (weekday.delete(7)) weekday.add(0);

  return {
    minute,
    hour,
    day,
    month,
    weekday,
    dayRestricted: dayField !== "*",
    weekdayRestricted: weekdayField !== "*",
  };
}

/**
 * Whether a moment falls on the schedule.
 *
 * Day-of-month and day-of-week are ORed when both are restricted and ANDed otherwise — the
 * long-standing cron rule that `0 0 13 * 5` means "the 13th, and also every Friday" rather
 * than "Friday the 13th". Getting this backwards is the classic way a hand-rolled scheduler
 * fires on the wrong days, so it is spelled out rather than left to operator precedence.
 */
export function matches(cron: ParsedCron, parts: CronParts): boolean {
  if (!cron.minute.has(parts.minute)) return false;
  if (!cron.hour.has(parts.hour)) return false;
  if (!cron.month.has(parts.month)) return false;

  const onDay = cron.day.has(parts.day);
  const onWeekday = cron.weekday.has(parts.weekday);
  if (cron.dayRestricted && cron.weekdayRestricted) return onDay || onWeekday;
  return onDay && onWeekday;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The wall-clock fields of a moment in a given zone. `Intl` rather than any date library:
 * "what is the local hour in Europe/Sofia right now" is exactly what it is for, and it
 * carries the DST rules with it.
 *
 * Throws `RangeError` on an unknown zone, which is how a trigger's timezone gets validated.
 */
export function partsIn(at: Date, timeZone: string): CronParts {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(at);

  const field = (type: Intl.DateTimeFormatPartTypes) => formatted.find((part) => part.type === type)?.value ?? "";

  return {
    // `hour12: false` still renders midnight as 24 in some environments; 24:00 is 00:00.
    minute: Number(field("minute")),
    hour: Number(field("hour")) % 24,
    day: Number(field("day")),
    month: Number(field("month")),
    weekday: WEEKDAYS[field("weekday")] ?? 0,
  };
}

/** Whether a zone is one `Intl` actually knows, checked before a trigger is stored. */
export function isTimeZone(timeZone: string): boolean {
  try {
    partsIn(new Date(0), timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The start of the minute containing `at`, which is the granularity a cron fires at. */
export const minuteStart = (at: Date): Date => new Date(Math.floor(at.getTime() / 60_000) * 60_000);
