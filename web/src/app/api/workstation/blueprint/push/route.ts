import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint, syncLog } from "~/server/db/schemas/blueprint";
import { syncLogger } from "~/lib/syncLogger";
import { verifyDeviceToken } from "~/lib/device-auth";
import { verifyHMACSignature } from "~/lib/hmac-verify";
import {
  idempotency,
  storeIdempotencyResponse,
} from "~/middleware/idempotency";
import { replayProtection } from "~/middleware/replay-protection";
import { env } from "~/env";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function POST(request: NextRequest) {
  // Check idempotency
  const idempotencyResult = await idempotency(request);
  // Only short-circuit when we're replaying a stored response
  if (idempotencyResult.headers.get("X-Idempotency-Replayed") === "true") {
    return idempotencyResult;
  }

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

    const body = await request.json();
    if (!verifyHMACSignature(body, timestamp, nonce, signature, hmacSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const { blueprintId, name, data, version, hash } = body;

    if (!blueprintId || !name || !data || !version || !hash) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Check for version conflict
    const existing = await db.query.blueprint.findFirst({
      where: eq(blueprint.id, blueprintId),
    });

    // Ownership check (prevent IDOR): existing blueprint must belong to the device's workstation
    if (existing && existing.workstationId !== claims.workstationId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (existing && existing.version >= version) {
      return NextResponse.json(
        { error: "Version conflict", currentVersion: existing.version },
        { status: 409 },
      );
    }

    // Update or create blueprint
    const now = new Date();
    const newVersion = existing ? version : 1;

    if (existing) {
      await db
        .update(blueprint)
        .set({
          name,
          metadata: JSON.stringify(data),
          version: newVersion,
          hash,
          syncStatus: "synced",
          lastSyncedAt: now,
          deviceId,
          updatedAt: now,
        })
        .where(eq(blueprint.id, blueprintId));
    } else {
      await db.insert(blueprint).values({
        id: blueprintId,
        name,
        metadata: JSON.stringify(data),
        version: newVersion,
        hash,
        syncStatus: "synced",
        lastSyncedAt: now,
        deviceId,
        workstationId: claims.workstationId,
        createdBy: claims.userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Log sync operation
    await db.insert(syncLog).values({
      id: nanoid(),
      blueprintId,
      deviceId,
      action: "push",
      direction: "to_server",
      status: "success",
      versionBefore: existing?.version,
      versionAfter: newVersion,
      createdAt: now,
    });

    syncLogger.info("blueprint.push.success", {
      blueprintId,
      deviceId,
      workstationId: claims.workstationId,
      versionBefore: existing?.version,
      versionAfter: newVersion,
    });

    const response = NextResponse.json({
      success: true,
      blueprintId,
      version: newVersion,
      syncStatus: "synced",
      serverTimestamp: now.toISOString(),
    });

    // Store idempotency response
    await storeIdempotencyResponse(request, response);

    return response;
  } catch (error) {
    syncLogger.error("blueprint.push.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("Push blueprint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
