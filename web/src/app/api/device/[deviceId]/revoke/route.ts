import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { ownedDevice } from "~/server/owned-device";

/**
 * Revokes a device. The row stays so history keeps attributing past pushes to it, but the
 * token hash is cleared, which takes effect on the device's very next request — there is
 * no session or cache to wait out.
 *
 * Getting rid of the row itself is a separate, deliberate second step: `DELETE ../[deviceId]`.
 */
export async function POST(request: Request, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;

  const owned = await ownedDevice(request, deviceId);
  if (owned instanceof NextResponse) return owned;

  await db
    .update(device)
    .set({ status: "revoked", isActive: false, tokenHash: null })
    .where(eq(device.id, deviceId));

  return NextResponse.json({ success: true });
}
