import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { scriptFile } from "~/server/db/schemas/script_file";
import { syncLogger } from "~/lib/syncLogger";
import { verifyDeviceToken } from "~/lib/device-auth";
import { verifyHMACSignature } from "~/lib/hmac-verify";
import {
  idempotency,
  storeIdempotencyResponse,
} from "~/middleware/idempotency";
import { replayProtection } from "~/middleware/replay-protection";
import { env } from "~/env";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const idempotencyResult = await idempotency(request);
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

    const { scriptId, name, language, source, hash } = body;

    if (!scriptId || !name || !source || !hash) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const existing = await db.query.scriptFile.findFirst({
      where: eq(scriptFile.id, scriptId),
    });

    if (existing && existing.workstationId !== claims.workstationId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const now = new Date();
    const newVersion = (existing?.version ?? 0) + 1;

    if (existing) {
      await db
        .update(scriptFile)
        .set({
          name,
          language: language || existing.language || "python",
          source,
          version: newVersion,
          hash,
          syncStatus: "synced",
          lastSyncedAt: now,
          deviceId,
          updatedAt: now,
        })
        .where(eq(scriptFile.id, scriptId));
    } else {
      await db.insert(scriptFile).values({
        id: scriptId,
        name,
        language: language || "python",
        source,
        version: 1,
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

    const response = NextResponse.json({
      success: true,
      scriptId,
      version: newVersion,
      syncStatus: "synced",
      serverTimestamp: now.toISOString(),
    });

    await storeIdempotencyResponse(request, response);

    return response;
  } catch (error) {
    syncLogger.error("script.push.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("Push script error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
