import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAutomation } from "~/server/automations/access";
import { createTrigger, triggerInputSchema } from "~/server/automations/triggers";
import { db } from "~/server/db";
import { automationTrigger } from "~/server/db/schemas/automation-trigger";

/**
 * How an automation gets invoked without somebody pressing "Run now".
 *
 * Until this existed nothing in the codebase wrote an `automation_trigger` row, so the
 * webhook receiver could never match one and cron had nothing to sweep — both were
 * unreachable code paths.
 */

export async function GET(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;
  const authed = await authorizeAutomation(request, workstationId, automationId);
  if (authed instanceof NextResponse) return authed;

  const rows = await db
    .select({
      id: automationTrigger.id,
      type: automationTrigger.type,
      key: automationTrigger.key,
      config: automationTrigger.config,
      lastFiredAt: automationTrigger.lastFiredAt,
      createdAt: automationTrigger.createdAt,
    })
    .from(automationTrigger)
    .where(eq(automationTrigger.automationId, automationId))
    .orderBy(asc(automationTrigger.createdAt));

  return NextResponse.json({ triggers: rows });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;
  const authed = await authorizeAutomation(request, workstationId, automationId);
  if (authed instanceof NextResponse) return authed;

  let body: z.infer<typeof triggerInputSchema>;
  try {
    body = triggerInputSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await createTrigger(automationId, workstationId, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, detail: result.detail }, { status: 400 });
  }

  return NextResponse.json({ success: true, trigger: result.trigger }, { status: 201 });
}
