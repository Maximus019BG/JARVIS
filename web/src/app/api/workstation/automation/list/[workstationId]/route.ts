import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { workstation } from "~/server/db/schemas/workstation";
import { eq } from "drizzle-orm";
import { auth } from "~/lib/auth";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ workstationId: string }> },
) {
  const { workstationId } = await ctx.params;
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!workstationId)
    return NextResponse.json(
      { error: "Workstation not found" },
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
    .where(eq(automation.workstationId, workstationId));

  return NextResponse.json(rows.map((r) => ({ ...r })));
}
