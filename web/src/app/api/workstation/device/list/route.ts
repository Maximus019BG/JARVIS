import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { verifyDeviceToken } from "~/lib/device-auth";
import { verifyHMACSignature } from "~/lib/hmac-verify";
import { replayProtection } from "~/middleware/replay-protection";
import { env } from "~/env";
import { eq } from "drizzle-orm";

type DeviceRow = typeof device.$inferSelect;

/**
 * GET /api/workstation/device/list
 *
 * Returns all devices registered to the same workstation as the calling
 * device.  Secured with the standard device-auth chain (JWT + HMAC + replay).
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    const deviceId = request.headers.get("X-Device-Id");
    const timestamp = request.headers.get("X-Timestamp");
    const nonce = request.headers.get("X-Nonce");
    const signature = request.headers.get("X-Signature");

    if (!token || !deviceId || !timestamp || !nonce || !signature) {
      return NextResponse.json(
        { error: "Missing required headers" },
        { status: 400 },
      );
    }

    const replayResult = await replayProtection(request);
    if (replayResult.status !== 200) {
      return replayResult;
    }

    const claims = await verifyDeviceToken(token);
    if (!claims || claims.deviceId !== deviceId) {
      return NextResponse.json(
        { error: "Invalid device token" },
        { status: 401 },
      );
    }

    const hmacSecret = env.BLUEPRINT_SYNC_HMAC_SECRET;
    if (!hmacSecret) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    if (!verifyHMACSignature({}, timestamp, nonce, signature, hmacSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // ── fetch all devices for this workstation ────────────────────
    const devices = await db.query.device.findMany({
      where: eq(device.workstationId, claims.workstationId),
    });

    const result = devices.map((d: DeviceRow) => ({
      id: d.id,
      name: d.name,
      isActive: d.isActive,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
      isCurrent: d.id === deviceId,
    }));

    return NextResponse.json({ devices: result });
  } catch (error) {
    console.error("Device /list error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
