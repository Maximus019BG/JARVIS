import { NextRequest, NextResponse } from 'next/server';
import { db } from '~/server/db';
import { blueprint, syncLog } from '~/server/db/schemas/blueprint';
import { verifyDeviceToken } from '~/lib/device-auth';
import { verifyHMACSignature } from '~/lib/hmac-verify';
import { replayProtection } from '~/middleware/replay-protection';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    const deviceId = request.headers.get('X-Device-Id');
    const timestamp = request.headers.get('X-Timestamp');
    const nonce = request.headers.get('X-Nonce');
    const signature = request.headers.get('X-Signature');

    if (!token || !deviceId || !timestamp || !nonce || !signature) {
      return NextResponse.json(
        { error: 'Missing required headers' },
        { status: 400 }
      );
    }

    const claims = await verifyDeviceToken(token);
    if (!claims || claims.deviceId !== deviceId) {
      return NextResponse.json(
        { error: 'Invalid device token' },
        { status: 401 }
      );
    }

    const replayResult = await replayProtection(request);
    if (replayResult.status !== 200) {
      return replayResult;
    }

    const hmacSecret = process.env.BLUEPRINT_SYNC_HMAC_SECRET;
    if (!hmacSecret) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const body = await request.json();
    if (!verifyHMACSignature(body, timestamp, nonce, signature, hmacSecret)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const { blueprintId, resolution, localData, serverData } = body;

    if (!blueprintId || !resolution || !localData || !serverData) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!['server', 'local', 'merge'].includes(resolution)) {
      return NextResponse.json(
        { error: 'Invalid resolution type' },
        { status: 400 }
      );
    }

    // Get current blueprint
    const existing = await db.query.blueprint.findFirst({
      where: eq(blueprint.id, blueprintId)
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Blueprint not found' },
        { status: 404 }
      );
    }

    // Ownership check (prevent IDOR): blueprint must belong to the device's workstation
    if (existing.workstationId !== claims.workstationId) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Determine merged data
    let mergedData;
    if (resolution === 'server') {
      mergedData = serverData;
    } else if (resolution === 'local') {
      mergedData = localData;
    } else {
      // Merge: server wins for conflicts, preserve local-only fields
      mergedData = { ...serverData };
      for (const key in localData) {
        if (!(key in mergedData)) {
          mergedData[key] = localData[key];
        }
      }
    }

    // Calculate new version
    const newVersion = (existing.version || 0) + 1;

    // Update blueprint
    const now = new Date();
    const newHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(mergedData))
      .digest('hex');

    await db.update(blueprint)
      .set({
        metadata: JSON.stringify(mergedData),
        version: newVersion,
        hash: newHash,
        syncStatus: 'synced',
        lastSyncedAt: now,
        deviceId,
        updatedAt: now
      })
      .where(eq(blueprint.id, blueprintId));

    // Log sync operation
    await db.insert(syncLog).values({
      id: nanoid(),
      blueprintId,
      deviceId,
      action: 'resolve',
      direction: 'to_server',
      status: 'success',
      versionBefore: existing.version,
      versionAfter: newVersion,
      createdAt: now
    });

    return NextResponse.json({
      success: true,
      blueprintId,
      version: newVersion,
      mergedData,
      hash: newHash
    });
  } catch (error) {
    console.error('Resolve conflict error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}