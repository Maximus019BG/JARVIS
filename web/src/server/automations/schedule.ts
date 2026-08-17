import { and, eq, isNull, lt, or } from "drizzle-orm";
import { matches, minuteStart, parseCron, partsIn } from "~/lib/automations/cron";
import { publishedVersionOf, startRun } from "~/server/automations/runner";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationTrigger } from "~/server/db/schemas/automation-trigger";

/**
 * Cron, swept by the device claim poll rather than by a scheduler process.
 *
 * The poll already sweeps timed-out jobs and already doubles as the device heartbeat, so
 * adding "and start anything the clock says is due" costs one statement and no new moving
 * parts. The consequence, and it is a deliberate one: **a cron only fires while a workstation
 * is polling.** A schedule whose minute passes with every machine asleep does not fire late,
 * it does not fire at all. That is the honest behaviour for this system — a workflow's `agent`
 * step needs a workstation awake to run on regardless, so a run started without one would
 * only sit suspended until it timed out.
 */

/** The columns the decision needs. Narrow on purpose, so it can be tested without a database. */
export type CronCandidate = {
  id: string;
  automationId: string;
  config: unknown;
  lastFiredAt: Date | null;
  /** From the automation, not the trigger: a paused automation must not fire. */
  status: string;
  publishedVersion: number | null;
};

/**
 * Whether a trigger should start a run at this moment.
 *
 * Pure, and the whole scheduling rule. `lastFiredAt` is compared against the start of the
 * current minute rather than against `now`, so a poll landing twice in the same minute — which
 * it does, the poll is every few seconds — sees the second one as already fired.
 */
export function isDue(candidate: CronCandidate, now: Date): boolean {
  if (candidate.status !== "active" || candidate.publishedVersion == null) return false;

  const minute = minuteStart(now);
  if (candidate.lastFiredAt && candidate.lastFiredAt >= minute) return false;

  const config = candidate.config as { expression?: unknown; tz?: unknown } | null;
  if (typeof config?.expression !== "string" || typeof config.tz !== "string") return false;

  const cron = parseCron(config.expression);
  if (!cron) return false;

  try {
    return matches(cron, partsIn(now, config.tz));
  } catch {
    // An unknown timezone. Validated at creation, so this only happens if the zone was
    // dropped from the runtime's database — never a reason to fail the device's poll.
    return false;
  }
}

/**
 * Starts a run for every due cron trigger on this workstation, and returns the ids that
 * fired.
 *
 * Never throws: this runs inside the claim poll, and a broken schedule must not stop a
 * workstation from being handed the jobs it asked for.
 */
export async function sweepCron(workstationId: string, now = new Date()): Promise<string[]> {
  const started: string[] = [];

  try {
    const candidates = await db
      .select({
        id: automationTrigger.id,
        automationId: automationTrigger.automationId,
        config: automationTrigger.config,
        lastFiredAt: automationTrigger.lastFiredAt,
        status: automation.status,
        publishedVersion: automation.publishedVersion,
      })
      .from(automationTrigger)
      .innerJoin(automation, eq(automation.id, automationTrigger.automationId))
      .where(and(eq(automationTrigger.workstationId, workstationId), eq(automationTrigger.type, "cron")));

    const minute = minuteStart(now);

    for (const candidate of candidates) {
      if (!isDue(candidate, now)) continue;

      // The real guard against two workstations firing the same schedule. `isDue` read a
      // snapshot; this write is conditional on the row still not having fired this minute,
      // so exactly one caller comes back with a row.
      const won = await db
        .update(automationTrigger)
        .set({ lastFiredAt: minute, updatedAt: now })
        .where(
          and(
            eq(automationTrigger.id, candidate.id),
            or(isNull(automationTrigger.lastFiredAt), lt(automationTrigger.lastFiredAt, minute)),
          ),
        )
        .returning({ id: automationTrigger.id });
      if (won.length === 0) continue;

      const version = await publishedVersionOf(candidate.automationId, candidate.publishedVersion);
      // The minute stays claimed either way. A schedule pointing at a version that was never
      // compiled would fail on every poll for a minute otherwise, once per poll.
      if (!version?.definition) continue;

      await startRun({
        automationId: candidate.automationId,
        automationVersionId: version.id,
        workstationId,
        triggerId: candidate.id,
        input: { trigger: "cron", firedAt: minute.toISOString() },
      });
      started.push(candidate.id);
    }
  } catch {
    // Deliberately swallowed, and deliberately not partial-rollback: each trigger above is
    // independent, so whatever already started stays started.
  }

  return started;
}
