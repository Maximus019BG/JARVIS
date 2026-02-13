import { and, asc, eq, lte, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { automationJob } from "~/server/db/schemas/automation-job";
import { automationRun } from "~/server/db/schemas/automation-run";
import { automationRunStep } from "~/server/db/schemas/automation-run-step";

export type RunnerOptions = {
  workerId?: string;
};

function now() {
  return new Date();
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function claimNextJob(workerId: string) {
  const claimed = await db
    .update(automationJob)
    .set({
      status: "running",
      lockedAt: now(),
      lockedBy: workerId,
      updatedAt: now(),
      attempts: sql`${automationJob.attempts} + 1`,
    })
    .where(
      and(
        eq(automationJob.status, "pending"),
        lte(automationJob.availableAt, now()),
        sql`${automationJob.lockedAt} is null`,
      ),
    )
    .returning();

  // Minimal: claim one at a time
  return claimed[0] ?? null;
}

export async function processOneJob(opts: RunnerOptions = {}) {
  const workerId = opts.workerId ?? `worker-${process.pid}`;

  const job = await claimNextJob(workerId);
  if (!job) return { processed: 0 as const };

  const run = (
    await db
      .select()
      .from(automationRun)
      .where(eq(automationRun.id, job.runId))
      .limit(1)
  )[0];

  if (!run) {
    await db
      .update(automationJob)
      .set({
        status: "failed",
        lastError: "Run not found",
        updatedAt: now(),
      })
      .where(eq(automationJob.id, job.id));

    return { processed: 1 as const };
  }

  // Move run to running if needed
  if (run.status === "queued") {
    await db
      .update(automationRun)
      .set({ status: "running", startedAt: run.startedAt ?? now() })
      .where(eq(automationRun.id, run.id));
  }

  const stepId = crypto.randomUUID();
  const stepIndex = job.stepIndex ?? 0;

  await db.insert(automationRunStep).values({
    id: stepId,
    runId: run.id,
    index: stepIndex,
    status: "running",
    type: "synthetic",
    name: "Synthetic step",
    input: job.payload ?? null,
    startedAt: now(),
    createdAt: now(),
  });

  // Minimal runner: execute a single synthetic step and mark run succeeded.
  try {
    const output = {
      message: "Milestone 2 runner executed",
      workerId,
      at: now().toISOString(),
    };

    await db
      .update(automationRunStep)
      .set({
        status: "succeeded",
        output,
        finishedAt: now(),
      })
      .where(eq(automationRunStep.id, stepId));

    await db
      .update(automationJob)
      .set({ status: "succeeded", updatedAt: now() })
      .where(eq(automationJob.id, job.id));

    // If there are no remaining pending/running jobs for the run, finish it.
    const remaining = await db
      .select({ id: automationJob.id })
      .from(automationJob)
      .where(
        and(
          eq(automationJob.runId, run.id),
          sql`${automationJob.status} in ('pending','running')`,
        ),
      )
      .orderBy(asc(automationJob.createdAt))
      .limit(1);

    if (remaining.length === 0) {
      const stepCountRes = await db
        .select({ c: sql<number>`count(*)` })
        .from(automationRunStep)
        .where(eq(automationRunStep.runId, run.id));

      await db
        .update(automationRun)
        .set({
          status: "succeeded",
          finishedAt: now(),
          stepCount: stepCountRes[0]?.c ?? run.stepCount,
        })
        .where(eq(automationRun.id, run.id));
    }

    return { processed: 1 as const };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    await db
      .update(automationRunStep)
      .set({ status: "failed", error: message, finishedAt: now() })
      .where(eq(automationRunStep.id, stepId));

    await db
      .update(automationJob)
      .set({ status: "failed", lastError: message, updatedAt: now() })
      .where(eq(automationJob.id, job.id));

    await db
      .update(automationRun)
      .set({ status: "failed", finishedAt: now() })
      .where(eq(automationRun.id, run.id));

    return { processed: 1 as const };
  }
}

export async function runWorkerLoop(params: {
  once?: boolean;
  pollIntervalMs?: number;
  workerId?: string;
}) {
  const once = params.once ?? false;
  const pollIntervalMs = params.pollIntervalMs ?? 1000;

  do {
    const res = await processOneJob({ workerId: params.workerId });
    if (once) return res;

    if (res.processed === 0) {
      await sleep(pollIntervalMs);
    }
  } while (true);
}
