import { NextResponse } from "next/server";

import { authorizeAutomation } from "~/server/automations/access";
import { publishedVersionOf, startRun } from "~/server/automations/runner";

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

  const authed = await authorizeAutomation(request, workstationId, automationId);
  if (authed instanceof NextResponse) return authed;
  const automationRecord = authed.automation;

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
