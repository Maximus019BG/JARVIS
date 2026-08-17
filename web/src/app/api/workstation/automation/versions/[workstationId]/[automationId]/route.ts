import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { authorizeAutomation } from "~/server/automations/access";
import { automationVersion } from "~/server/db/schemas/automation-version";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;

  const authed = await authorizeAutomation(request, workstationId, automationId);
  if (authed instanceof NextResponse) return authed;
  const automationRecord = authed.automation;

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
