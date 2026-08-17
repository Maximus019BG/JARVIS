import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { approval } from "~/server/db/schemas/approval";
import { authenticateDevice, forbidden } from "~/server/device-auth";

type Context = { params: Promise<{ id: string }> };

/** The device's poll: has anybody answered yet? */
export async function GET(request: Request, ctx: Context) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;

  const { id } = await ctx.params;
  const row = (await db.select().from(approval).where(eq(approval.id, id)).limit(1))[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Without this a device could read another device's prompts, which are a running
  // commentary on somebody else's files.
  if (row.deviceId !== authed.device.id) return forbidden("this approval belongs to another device");

  return NextResponse.json({ answer: row.answer, expired: row.expiresAt.getTime() < Date.now() });
}

/** The terminal answered first, so take the prompt off the phone. */
export async function DELETE(request: Request, ctx: Context) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;

  const { id } = await ctx.params;
  await db
    .update(approval)
    .set({ answer: "cancelled", answeredAt: new Date() })
    .where(and(eq(approval.id, id), eq(approval.deviceId, authed.device.id), isNull(approval.answer)));

  // Unconditional 200: a no-op means somebody already answered, and the device has moved
  // on either way.
  return NextResponse.json({ success: true });
}
