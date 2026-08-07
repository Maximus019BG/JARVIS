import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { workstation } from "~/server/db/schemas/workstation";
import { eq, and } from "drizzle-orm";
import { auth } from "~/lib/auth";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;
  const session = await auth.api.getSession({ headers: _request.headers });
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!workstationId)
    return NextResponse.json(
      { error: "Workstation not found" },
      { status: 404 },
    );
  if (!automationId)
    return NextResponse.json(
      { error: "Automation not found" },
      { status: 404 },
    );


  const workstationRecord = (
    await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, workstationId))
      .limit(1)
  )[0];
  if (!workstationRecord || workstationRecord.userId !== session.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(automation)
    .where(
      and(
        eq(automation.id, automationId),
        eq(automation.workstationId, workstationId),
      ),
    )
    .limit(1);
  const record = rows[0];
  if (!record)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // For milestone 1: keep response backward compatible but add versioning info.
  return NextResponse.json({
    ...record,
    versioning: {
      status: record.status,
      publishedVersion: record.publishedVersion,
    },
  });
}
