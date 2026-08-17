import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { advance, failRun } from "~/server/automations/runner";
import { db } from "~/server/db";
import { automationJob } from "~/server/db/schemas/automation-job";
import { automationRun } from "~/server/db/schemas/automation-run";
import { automationRunStep } from "~/server/db/schemas/automation-run-step";
import { authenticateDevice, forbidden } from "~/server/device-auth";

/** An agent's output can be long, but a step row is not a log store. */
const MAX_TEXT = 200_000;

const bodySchema = z.object({
  jobId: z.string().min(1).max(64),
  ok: z.boolean(),
  text: z.string().max(MAX_TEXT).optional(),
  error: z.string().max(4000).optional(),
  usage: z.object({ input: z.number(), output: z.number(), cost: z.number() }).partial().optional(),
});

export async function POST(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  const { device } = authed;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const job = (await db.select().from(automationJob).where(eq(automationJob.id, body.jobId)).limit(1))[0];
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // The trust boundary. Without both checks any paired device could post results into
  // another workstation's runs, or steal a job it was never handed.
  if (job.lockedBy !== device.id) return forbidden("that job was handed to another device");
  const run = (await db.select().from(automationRun).where(eq(automationRun.id, job.runId)).limit(1))[0];
  if (run?.workstationId !== device.workstationId) return forbidden("that run belongs to another workstation");

  // Idempotent: a device retrying after the sweep already failed its job gets a 200 and
  // changes nothing, rather than resurrecting a run somebody has already been told failed.
  if (job.status !== "running") {
    return NextResponse.json({ success: true, ignored: true, status: job.status });
  }

  const payload = (job.payload ?? {}) as { stepId?: string };
  const stepId = payload.stepId ?? null;
  const at = new Date();

  if (!body.ok) {
    await db
      .update(automationJob)
      .set({ status: "failed", lastError: (body.error ?? "the agent failed").slice(0, 2000), updatedAt: at })
      .where(eq(automationJob.id, job.id));
    await failRun(job.runId, stepId, body.error ?? "the agent failed");
    return NextResponse.json({ success: true, status: "failed" });
  }

  await db.update(automationJob).set({ status: "succeeded", updatedAt: at }).where(eq(automationJob.id, job.id));
  if (stepId) {
    await db
      .update(automationRunStep)
      .set({ status: "succeeded", output: { text: body.text ?? "", usage: body.usage ?? null }, finishedAt: at })
      .where(eq(automationRunStep.id, stepId));
  }

  // Pick the run back up where it suspended, which may finish it or suspend it again on the
  // next agent node.
  const result = await advance(job.runId);
  return NextResponse.json({ success: true, ...result });
}
