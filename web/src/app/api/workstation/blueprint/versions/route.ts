import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { verifyDeviceById } from "~/lib/device-auth";
import { verifyHMACSignature } from "~/lib/hmac-verify";
import { replayProtection } from "~/middleware/replay-protection";
import { env } from "~/env";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/workstation/blueprint/versions?blueprintId=<id>
 *
 * Returns the list of historical versions for a blueprint, ordered
 * newest-first.  Requires the standard device-auth security headers.
 */
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

    const replayResult = await replayProtection(request);
    if (replayResult.status !== 200) {
      return replayResult;
    }

    const claims = await verifyDeviceById(deviceId);
    if (!claims) {
      return NextResponse.json(
        { error: "Unknown or inactive device" },
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

    const url = new URL(request.url);
    const blueprintId = url.searchParams.get("blueprintId");

    if (!blueprintId) {
      return NextResponse.json(
        { error: "blueprintId query parameter is required" },
        { status: 400 },
      );
    }

    const payload = { blueprintId };
    if (!verifyHMACSignature(payload, timestamp, nonce, signature, hmacSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Ownership check
    const bp = await db.query.blueprint.findFirst({
      where: eq(blueprint.id, blueprintId),
    });

    if (!bp) {
      return NextResponse.json(
        { error: "Blueprint not found" },
        { status: 404 },
      );
    }

    if (bp.workstationId !== claims.workstationId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Fetch all historical snapshots for this blueprint
    const versions = await db.query.blueprintVersion.findMany({
      where: eq(blueprintVersion.blueprintId, blueprintId),
      orderBy: [desc(blueprintVersion.version)],
    });

    return NextResponse.json({
      success: true,
      blueprintId,
      currentVersion: bp.version,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        hash: v.hash,
        deviceId: v.deviceId,
        createdAt: v.createdAt,
      })),
    });
  } catch (error) {
    console.error("Blueprint versions error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
