import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { workstation } from "~/server/db/schemas/workstation";

export type SessionBlueprint = {
  userId: string;
  blueprint: typeof blueprint.$inferSelect;
};

/**
 * The session-side counterpart to `authenticateDevice`: signed-in user, blueprint exists,
 * and the workstation holding it belongs to them. Every browser-facing blueprint route
 * starts here, so the ownership check cannot be forgotten in one of them.
 */
export async function requireBlueprint(
  request: Request,
  blueprintId: string,
): Promise<SessionBlueprint | NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = (
    await db.select().from(blueprint).where(eq(blueprint.id, blueprintId)).limit(1)
  )[0];
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const owner = (
    await db.select().from(workstation).where(eq(workstation.id, found.workstationId)).limit(1)
  )[0];
  if (!owner || owner.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { userId: session.user.id, blueprint: found };
}
