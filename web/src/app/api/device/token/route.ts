import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { deviceLink } from "~/server/db/schemas/device_link";
import { newToken, POLL_INTERVAL_SECONDS, sha256, TOKEN_PREFIX } from "~/server/device-auth";

const bodySchema = z.object({ deviceCode: z.string().min(16).max(256) });

/** RFC 8628 uses 400 with an `error` code for every not-yet state, not a bare 404. */
const pending = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Step two of RFC 8628: the device polls here until a human approves.
 *
 * The token is minted *at this moment*, not at approval — approval creates the device row
 * with no token at all. That way the only readable copy of the secret exists inside this
 * one response, and the database never holds anything but its hash.
 */
export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return pending("invalid_request");
  }

  const rows = await db
    .select()
    .from(deviceLink)
    .where(eq(deviceLink.deviceCodeHash, sha256(body.deviceCode)))
    .limit(1);
  const link = rows[0];
  if (!link) return pending("expired_token");

  if (link.expiresAt.getTime() < Date.now()) {
    await db.delete(deviceLink).where(eq(deviceLink.userCode, link.userCode));
    return pending("expired_token");
  }

  // Polling faster than we advertised gets told to slow down rather than served.
  const since = link.lastPolledAt ? Date.now() - link.lastPolledAt.getTime() : Infinity;
  if (since < POLL_INTERVAL_SECONDS * 1000 * 0.8) {
    return NextResponse.json({ error: "slow_down", interval: POLL_INTERVAL_SECONDS }, { status: 429 });
  }
  await db.update(deviceLink).set({ lastPolledAt: new Date() }).where(eq(deviceLink.userCode, link.userCode));

  if (!link.approvedDeviceId) {
    return NextResponse.json(
      { error: "authorization_pending", interval: POLL_INTERVAL_SECONDS },
      { status: 400 },
    );
  }

  const deviceRows = await db.select().from(device).where(eq(device.id, link.approvedDeviceId)).limit(1);
  const paired = deviceRows[0];
  if (!paired || paired.status !== "active") {
    await db.delete(deviceLink).where(eq(deviceLink.userCode, link.userCode));
    return pending("access_denied");
  }

  // Already issued once. Re-issuing on a replayed device code would hand a second
  // credential to whoever replayed it, so this is a dead end, not a retry.
  if (paired.tokenHash) {
    await db.delete(deviceLink).where(eq(deviceLink.userCode, link.userCode));
    return pending("access_denied");
  }

  const token = newToken();
  await db
    .update(device)
    .set({ tokenHash: sha256(token), tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 6) })
    .where(eq(device.id, paired.id));
  await db.delete(deviceLink).where(eq(deviceLink.userCode, link.userCode));

  return NextResponse.json({
    deviceId: paired.id,
    token,
    workstationId: paired.workstationId,
    name: paired.name,
  });
}
