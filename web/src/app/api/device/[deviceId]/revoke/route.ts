import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { workstation } from "~/server/db/schemas/workstation";

/**
 * Revokes a device. The row stays so history keeps attributing past pushes to it, but the
 * token hash is cleared, which takes effect on the device's very next request — there is
 * no session or cache to wait out.
 */
export async function POST(request: Request, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = (await db.select().from(device).where(eq(device.id, deviceId)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  //Check if user owns workstation
  const owned = (await db.select().from(workstation).where(eq(workstation.id, target.workstationId)).limit(1))[0];
  if (owned?.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db
    .update(device)
    .set({ status: "revoked", isActive: false, tokenHash: null })
    .where(eq(device.id, deviceId));

  return NextResponse.json({ success: true });
}
