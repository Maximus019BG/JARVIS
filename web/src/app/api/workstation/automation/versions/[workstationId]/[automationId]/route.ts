import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationVersion } from "~/server/db/schemas/automation-version";
import { workstation } from "~/server/db/schemas/workstation";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });


  const workstationRecord = (
    await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, workstationId))
      .limit(1)
  )[0];
  if (!workstationRecord || workstationRecord.userId !== session.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const automationRecord = (
    await db
      .select()
      .from(automation)
      .where(
        and(
          eq(automation.id, automationId),
          eq(automation.workstationId, workstationId),
        ),
      )
      .limit(1)
  )[0];

  if (!automationRecord)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const versions = await db
    .select({
      id: automationVersion.id,
      version: automationVersion.version,
      createdAt: automationVersion.createdAt,
      createdBy: automationVersion.createdBy,
    })
    .from(automationVersion)
    .where(eq(automationVersion.automationId, automationId))
    .orderBy(desc(automationVersion.version));

  return NextResponse.json({
    success: true,
    automation: {
      id: automationRecord.id,
      name: automationRecord.name,
      status: automationRecord.status,
      publishedVersion: automationRecord.publishedVersion,
    },
    versions,
  });
}
