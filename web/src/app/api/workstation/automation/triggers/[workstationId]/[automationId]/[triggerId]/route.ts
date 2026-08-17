import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authorizeAutomation } from "~/server/automations/access";
import { db } from "~/server/db";
import { automationTrigger } from "~/server/db/schemas/automation-trigger";

/**
 * Removes a trigger. For a webhook this revokes the URL — the receiver matches on the row,
 * so a deleted trigger is a 404 for anyone still holding the old address.
 *
 * Runs already started keep their `triggerId`, which is why `automation_run` does not
 * cascade from here: history should still say what set a run going.
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string; triggerId: string }> },
) {
  const { workstationId, automationId, triggerId } = await ctx.params;
  const authed = await authorizeAutomation(request, workstationId, automationId);
  if (authed instanceof NextResponse) return authed;

  // Scoped by automation as well as by id, so a trigger id from another automation the user
  // happens to own still does not delete through this route.
  const deleted = await db
    .delete(automationTrigger)
    .where(and(eq(automationTrigger.id, triggerId), eq(automationTrigger.automationId, automationId)))
    .returning({ id: automationTrigger.id });

  if (deleted.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
