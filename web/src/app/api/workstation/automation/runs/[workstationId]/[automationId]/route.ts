import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { automationRun } from "~/server/db/schemas/automation-run";
import { authorizeAutomation } from "~/server/automations/access";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;
  const authorized = await authorizeAutomation(request, workstationId, automationId);
  if (authorized instanceof NextResponse) return authorized;

  const runs = await db
    .select({
      id: automationRun.id,
      status: automationRun.status,
      createdAt: automationRun.createdAt,
      startedAt: automationRun.startedAt,
      finishedAt: automationRun.finishedAt,
      stepCount: automationRun.stepCount,
      triggerId: automationRun.triggerId,
    })
    .from(automationRun)
    .where(
      and(
        eq(automationRun.automationId, automationId),
        eq(automationRun.workstationId, workstationId),
      ),
    )
    .orderBy(desc(automationRun.createdAt))
    .limit(100);

  return NextResponse.json({ runs });
}
