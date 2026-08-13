import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "~/lib/auth";
import { publishedVersionOf, startRun } from "~/server/automations/runner";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { workstation } from "~/server/db/schemas/workstation";

/**
 * "Run now" — the manual trigger. Same body as the webhook receiver from the runner's point
 * of view: it starts a run against the published version and returns a `runId`, because an
 * `agent` node suspends the run for as long as a workstation takes to answer.
 *
 * The sibling route with a `[runId]` is the GET that reads one back.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workstationRecord = (
    await db.select().from(workstation).where(eq(workstation.id, workstationId)).limit(1)
  )[0];
  if (workstationRecord?.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const automationRecord = (
    await db
      .select()
      .from(automation)
      .where(and(eq(automation.id, automationId), eq(automation.workstationId, workstationId)))
      .limit(1)
  )[0];
  if (!automationRecord) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (automationRecord.status !== "active" || !automationRecord.publishedVersion) {
    return NextResponse.json({ error: "Automation not published" }, { status: 400 });
  }

  const versionRecord = await publishedVersionOf(automationRecord.id, automationRecord.publishedVersion);
  if (!versionRecord) {
    return NextResponse.json({ error: "Published version missing" }, { status: 409 });
  }
  // Only `publish` writes `definition`, and `advance` treats a missing one as an empty graph —
  // so without this the run would report success having executed nothing at all.
  if (!versionRecord.definition) {
    return NextResponse.json({ error: "Published version was never compiled" }, { status: 409 });
  }

  // The body is the trigger payload the definition sees as `{{$json}}`. Absent is fine — a
  // manual run of a workflow that reads nothing from its trigger is the common case.
  const input: unknown = await request.json().catch(() => null);

  try {
    const result = await startRun({
      automationId: automationRecord.id,
      automationVersionId: versionRecord.id,
      workstationId,
      triggerId: null,
      input,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
