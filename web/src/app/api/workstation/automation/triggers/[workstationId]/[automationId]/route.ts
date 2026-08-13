import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isTimeZone, parseCron } from "~/lib/automations/cron";
import { authorizeAutomation } from "~/server/automations/access";
import { db } from "~/server/db";
import { automationTrigger } from "~/server/db/schemas/automation-trigger";

/**
 * How an automation gets invoked without somebody pressing "Run now".
 *
 * Until this existed nothing in the codebase wrote an `automation_trigger` row, so the
 * webhook receiver could never match one and cron had nothing to sweep — both were
 * unreachable code paths.
 */

const cronConfigSchema = z.object({
  expression: z.string().trim().min(1).max(200),
  /** IANA zone. A cron with no zone is a cron that fires at the wrong time twice a year. */
  tz: z.string().trim().min(1).max(64),
});

const bodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook") }),
  z.object({ type: z.literal("cron"), config: cronConfigSchema }),
]);

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

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Validated here rather than at sweep time on purpose: a bad expression that is only
  // noticed by the scheduler is a trigger that silently never fires, and nobody goes looking
  // for a run that never happened.
  if (body.type === "cron") {
    if (!parseCron(body.config.expression)) {
      return NextResponse.json(
        { error: "invalid_cron", detail: "Expected five fields: minute hour day-of-month month day-of-week." },
        { status: 400 },
      );
    }
    if (!isTimeZone(body.config.tz)) {
      return NextResponse.json(
        { error: "invalid_timezone", detail: `Not an IANA time zone: ${body.config.tz}` },
        { status: 400 },
      );
    }
  }

  const id = `atr_${nanoid(16)}`;
  const now = new Date();
  await db.insert(automationTrigger).values({
    id,
    automationId,
    workstationId,
    type: body.type,
    // The webhook URL's only secret-ish component. Cron never uses it, but the column is
    // `notNull` and an unused id costs nothing.
    key: nanoid(24),
    config: body.type === "cron" ? body.config : null,
    createdAt: now,
  });

  const created = (
    await db.select().from(automationTrigger).where(eq(automationTrigger.id, id)).limit(1)
  )[0];
  return NextResponse.json({ success: true, trigger: created }, { status: 201 });
}
