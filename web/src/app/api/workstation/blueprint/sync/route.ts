import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { verifyDeviceById } from "~/lib/device-auth";
import { verifyHMACSignature } from "~/lib/hmac-verify";
import { replayProtection } from "~/middleware/replay-protection";
import { env } from "~/env";
import { eq, and, gte, isNull } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const deviceId = request.headers.get("X-Device-Id");
    const timestamp = request.headers.get("X-Timestamp");
    const nonce = request.headers.get("X-Nonce");
    const signature = request.headers.get("X-Signature");

    if (!deviceId || !timestamp || !nonce || !signature) {
      return NextResponse.json(
        { error: "Missing required headers" },
        { status: 400 },
      );
    }

    // Verify device by ID lookup
    const claims = await verifyDeviceById(deviceId);
    if (!claims) {
      return NextResponse.json(
        { error: "Unknown or inactive device" },
        { status: 401 },
      );
    }

    const replayResult = await replayProtection(request);
    if (replayResult.status !== 200) {
      return replayResult;
    }

    // Verify HMAC signature
    const hmacSecret = env.BLUEPRINT_SYNC_HMAC_SECRET;
    if (!hmacSecret) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const url = new URL(request.url);
    const since = url.searchParams.get("since");

    const payload = { since };
    if (
      !verifyHMACSignature(payload, timestamp, nonce, signature, hmacSecret)
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Get blueprints
    let blueprints;
    if (since) {
      blueprints = await db.query.blueprint.findMany({
        where: and(
          eq(blueprint.workstationId, claims.workstationId),
          gte(blueprint.updatedAt, new Date(since)),
        ),
      });
    } else {
      blueprints = await db.query.blueprint.findMany({
        where: eq(blueprint.workstationId, claims.workstationId),
      });
    }

    return NextResponse.json({
      success: true,
      serverTime: new Date().toISOString(),
      blueprints: blueprints.map((bp) => ({
        id: bp.id,
        name: bp.name,
        version: bp.version,
        hash: bp.hash,
        lastModified: bp.updatedAt || bp.createdAt,
        syncStatus: bp.syncStatus || "synced",
      })),
    });
  } catch (error) {
    console.error("Sync status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
