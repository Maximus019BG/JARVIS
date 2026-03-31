import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint, syncLog } from "~/server/db/schemas/blueprint";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { syncLogger } from "~/lib/syncLogger";
import { verifyDeviceById } from "~/lib/device-auth";
import { verifyHMACSignature } from "~/lib/hmac-verify";
import { replayProtection } from "~/middleware/replay-protection";
import { env } from "~/env";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * POST /api/workstation/blueprint/restore
 *
 * Rolls a blueprint back to a specific historical version snapshot.
 * The current live content is saved as a new snapshot in
 * `blueprint_version` before the restore is applied so that the
 * rollback itself is also reversible.
 *
 * Request body: { blueprintId: string, targetVersion: number }
 *
 * Security: standard device-auth chain (device ID lookup + HMAC + replay).
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    if (!verifyHMACSignature(body, timestamp, nonce, signature, hmacSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const { blueprintId, targetVersion } = body;

    if (!blueprintId || targetVersion === undefined || targetVersion === null) {
      return NextResponse.json(
        { error: "blueprintId and targetVersion are required" },
        { status: 400 },
      );
    }

    // Load current blueprint (ownership + existence check)
    const existing = await db.query.blueprint.findFirst({
      where: eq(blueprint.id, blueprintId),
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Blueprint not found" },
        { status: 404 },
      );
    }

    if (existing.workstationId !== claims.workstationId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Locate the requested historical snapshot
    const snapshot = await db.query.blueprintVersion.findFirst({
      where: and(
        eq(blueprintVersion.blueprintId, blueprintId),
        eq(blueprintVersion.version, targetVersion),
      ),
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: "Version not found" },
        { status: 404 },
      );
    }

    const now = new Date();

    // Snapshot the current live version before rolling back
    await db.insert(blueprintVersion).values({
      id: nanoid(),
      blueprintId,
      version: existing.version,
      metadata: existing.metadata ?? "{}",
      hash: existing.hash ?? null,
      deviceId: existing.deviceId ?? null,
      createdBy: claims.userId,
      createdAt: now,
    });

    // The restored version gets a new (incremented) version number so
    // that the version counter stays monotonically increasing.
    const newVersion = existing.version + 1;

    await db
      .update(blueprint)
      .set({
        metadata: snapshot.metadata,
        version: newVersion,
        hash: snapshot.hash ?? null,
        syncStatus: "synced",
        lastSyncedAt: now,
        deviceId,
        updatedAt: now,
      })
      .where(eq(blueprint.id, blueprintId));

    // Log the restore operation
    await db.insert(syncLog).values({
      id: nanoid(),
      blueprintId,
      deviceId,
      action: "restore",
      direction: "to_server",
      status: "success",
      versionBefore: existing.version,
      versionAfter: newVersion,
      createdAt: now,
    });

    syncLogger.info("blueprint.restore.success", {
      blueprintId,
      deviceId,
      workstationId: claims.workstationId,
      targetVersion,
      versionBefore: existing.version,
      versionAfter: newVersion,
    });

    let restoredData: unknown;
    try {
      restoredData = JSON.parse(snapshot.metadata);
    } catch {
      restoredData = {};
    }

    return NextResponse.json({
      success: true,
      blueprintId,
      restoredFromVersion: targetVersion,
      version: newVersion,
      hash: snapshot.hash,
      data: restoredData,
    });
  } catch (error) {
    syncLogger.error("blueprint.restore.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("Restore blueprint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
