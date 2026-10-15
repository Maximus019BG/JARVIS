import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { automationRun } from "~/server/db/schemas/automation-run";
import { automationRunStep } from "~/server/db/schemas/automation-run-step";
import { authorizeAutomation } from "~/server/automations/access";

export async function GET(
  request: Request,
  ctx: {
    params: Promise<{ workstationId: string; automationId: string; runId: string }>;
  },
) {
  const { workstationId, automationId, runId } = await ctx.params;
  const authorized = await authorizeAutomation(request, workstationId, automationId);
  if (authorized instanceof NextResponse) return authorized;

  // Together: the steps are only returned when the scoped run lookup finds the run, so
  // fetching them in parallel saves a round trip without showing anything extra.
  const [runs, steps] = await Promise.all([
    db
      .select()
      .from(automationRun)
      .where(
        and(
          eq(automationRun.id, runId),
          eq(automationRun.automationId, automationId),
          eq(automationRun.workstationId, workstationId),
        ),
      )
      .limit(1),
    db
      .select({
        id: automationRunStep.id,
        index: automationRunStep.index,
        status: automationRunStep.status,
        type: automationRunStep.type,
        name: automationRunStep.name,
        input: automationRunStep.input,
        output: automationRunStep.output,
        error: automationRunStep.error,
        startedAt: automationRunStep.startedAt,
        finishedAt: automationRunStep.finishedAt,
        createdAt: automationRunStep.createdAt,
      })
      .from(automationRunStep)
      .where(eq(automationRunStep.runId, runId))
      .orderBy(asc(automationRunStep.index)),
  ]);

  const run = runs[0];
  if (!run) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ run, steps });
}
