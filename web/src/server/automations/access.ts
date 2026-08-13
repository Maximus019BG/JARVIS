import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { workstation } from "~/server/db/schemas/workstation";

/**
 * The signed-in-owner check every automation route repeats: the user owns the workstation,
 * and the automation belongs to it.
 *
 * Returns the automation row, or the `NextResponse` to return instead — the same shape
 * `authenticateDevice` uses for device routes, so a handler is one `instanceof` away from
 * either carrying on or bailing out.
 *
 * Scoping the automation lookup by workstation as well as by id is the part that matters:
 * without it, knowing an automation id would be enough to reach one under a workstation you
 * do not own.
 */
export async function authorizeAutomation(
  request: Request,
  workstationId: string,
  automationId: string,
): Promise<typeof automation.$inferSelect | NextResponse> {
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

  return automationRecord;
}
