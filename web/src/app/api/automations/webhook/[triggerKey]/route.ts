import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationVersion } from "~/server/db/schemas/automation-version";
import { automationTrigger } from "~/server/db/schemas/automation-trigger";
import { automationRun } from "~/server/db/schemas/automation-run";
import { automationRunStep } from "~/server/db/schemas/automation-run-step";

function getProvidedSecret(request: Request, url: URL) {
  return (
    request.headers.get("x-automation-secret") ??
    request.headers.get("x-webhook-secret") ??
    url.searchParams.get("secret")
  );
}

function now() {
  return new Date();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Execution timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function planStepsFromDefinition(definition: unknown): Array<{ type: string; name: string; input: any }> {
  const def = definition as any;
  const nodes = Array.isArray(def?.nodes) ? def.nodes : [];

  // Minimal, Vercel-safe plan: one step per definition node, in definition order.
  if (nodes.length > 0) {
    return nodes.map((n: any, idx: number) => ({
      type: String(n?.type ?? "synthetic"),
      name: String(n?.name ?? `Step ${idx + 1}`),
      input: {
        nodeId: n?.id ?? null,
        params: n?.params ?? {},
      },
    }));
  }

  // Fallback: single synthetic step.
  return [
    {
      type: "synthetic",
      name: "Synthetic step",
      input: { message: "Missing automation definition" },
    },
  ];
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ triggerKey: string }> },
) {
  const { triggerKey } = await ctx.params;

  const url = new URL(request.url);
  const providedSecret = getProvidedSecret(request, url);
  if (!providedSecret || providedSecret !== env.AUTOMATION_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const triggerRecord = (
    await db
      .select()
      .from(automationTrigger)
      .where(
        and(eq(automationTrigger.type, "webhook"), eq(automationTrigger.key, triggerKey)),
      )
      .limit(1)
  )[0];

  if (!triggerRecord) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const automationRecord = (
    await db
      .select()
      .from(automation)
      .where(
        and(
          eq(automation.id, triggerRecord.automationId),
          eq(automation.workstationId, triggerRecord.workstationId),
        ),
      )
      .limit(1)
  )[0];

  if (!automationRecord) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (automationRecord.status !== "active" || !automationRecord.publishedVersion) {
    return NextResponse.json(
      { error: "Automation not published" },
      { status: 400 },
    );
  }

  const versionRecord = (
    await db
      .select()
      .from(automationVersion)
      .where(eq(automationVersion.automationId, automationRecord.id))
      .orderBy(desc(automationVersion.version))
      .limit(1)
  )[0];

  if (!versionRecord || versionRecord.version !== automationRecord.publishedVersion) {
    return NextResponse.json(
      { error: "Published version missing" },
      { status: 409 },
    );
  }

  const input = await request.json().catch(() => null);

  const runId = crypto.randomUUID();
  const startedAt = now();

  // Create run record and immediately execute within this request (serverless-friendly).
  await db.insert(automationRun).values({
    id: runId,
    automationId: automationRecord.id,
    automationVersionId: versionRecord.id,
    workstationId: automationRecord.workstationId,
    status: "running",
    triggerId: triggerRecord.id,
    input,
    startedAt,
    createdAt: startedAt,
  });

  const execute = async () => {
    const steps = planStepsFromDefinition(versionRecord.definition);

    let stepIndex = 0;
    for (const step of steps) {
      const stepId = crypto.randomUUID();

      await db.insert(automationRunStep).values({
        id: stepId,
        runId,
        index: stepIndex,
        status: "running",
        type: step.type,
        name: step.name,
        input: {
          ...step.input,
          trigger: {
            type: "webhook",
            key: triggerRecord.key,
          },
          request: input,
        },
        startedAt: now(),
        createdAt: now(),
      });

      // Minimal executor: mark succeeded with a small output payload.
      const output = {
        ok: true,
        stepIndex,
        at: now().toISOString(),
      };

      await db
        .update(automationRunStep)
        .set({ status: "succeeded", output, finishedAt: now() })
        .where(eq(automationRunStep.id, stepId));

      stepIndex++;
    }

    await db
      .update(automationRun)
      .set({
        status: "succeeded",
        finishedAt: now(),
        stepCount: steps.length,
      })
      .where(eq(automationRun.id, runId));

    return { stepsPlanned: steps.length };
  };

  const MAX_EXECUTION_MS = 8_000;

  try {
    const execRes = await withTimeout(execute(), MAX_EXECUTION_MS);

    return NextResponse.json({
      success: true,
      runId,
      status: "succeeded",
      ...execRes,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    await db
      .update(automationRun)
      .set({ status: "failed", finishedAt: now() })
      .where(eq(automationRun.id, runId));

    // Best-effort: if no steps were created, write a failure step for visibility.
    const stepId = crypto.randomUUID();
    await db.insert(automationRunStep).values({
      id: stepId,
      runId,
      index: 0,
      status: "failed",
      type: "synthetic",
      name: "Execution failed",
      input,
      error: message,
      startedAt,
      finishedAt: now(),
      createdAt: now(),
    });

    return NextResponse.json(
      {
        success: false,
        runId,
        status: "failed",
        error: message,
      },
      { status: 500 },
    );
  }
}
