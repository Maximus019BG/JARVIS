import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationVersion } from "~/server/db/schemas/automation-version";
import { automationTrigger } from "~/server/db/schemas/automation-trigger";
import { automationRun } from "~/server/db/schemas/automation-run";
import { automationJob } from "~/server/db/schemas/automation-job";

function getProvidedSecret(request: Request, url: URL) {
  return (
    request.headers.get("x-automation-secret") ??
    request.headers.get("x-webhook-secret") ??
    url.searchParams.get("secret")
  );
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

  await db.insert(automationRun).values({
    id: runId,
    automationId: automationRecord.id,
    automationVersionId: versionRecord.id,
    workstationId: automationRecord.workstationId,
    status: "queued",
    triggerId: triggerRecord.id,
    input,
    createdAt: new Date(),
  });

  await db.insert(automationJob).values({
    id: crypto.randomUUID(),
    runId,
    stepIndex: 0,
    status: "pending",
    attempts: 0,
    payload: {
      trigger: {
        type: "webhook",
        key: triggerRecord.key,
      },
    },
    availableAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return NextResponse.json({
    success: true,
    runId,
  });
}
