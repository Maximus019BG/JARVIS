import { NextRequest, NextResponse } from 'next/server';
import { db } from '~/server/db';
import { blueprint, syncLog } from '~/server/db/schemas/blueprint';
import { verifyDeviceToken } from '~/lib/device-auth';
import { verifyHMACSignature } from '~/lib/hmac-verify';
import { replayProtection } from '~/middleware/replay-protection';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

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

    const { blueprintId, localVersion } = body;

    if (!blueprintId) {
      return NextResponse.json(
        { error: 'blueprintId is required' },
        { status: 400 }
      );
    }

    const bp = await db.query.blueprint.findFirst({
      where: eq(blueprint.id, blueprintId)
    });

    if (!bp) {
      return NextResponse.json(
        { error: 'Blueprint not found' },
        { status: 404 }
      );
    }

    // Check if workstation matches
    if (bp.workstationId !== claims.workstationId) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Parse metadata
    let data;
    try {
      data = JSON.parse(bp.metadata || '{}');
    } catch {
      data = {};
    }

    // Log sync operation
    await db.insert(syncLog).values({
      id: nanoid(),
      blueprintId,
      deviceId,
      action: 'pull',
      direction: 'to_device',
      status: 'success',
      versionBefore: localVersion,
      versionAfter: bp.version,
      createdAt: new Date()
    });

    return NextResponse.json({
      success: true,
      blueprint: {
        id: bp.id,
        name: bp.name,
        data,
        version: bp.version,
        hash: bp.hash,
        lastModified: bp.updatedAt || bp.createdAt
      }
    });
  } catch (error) {
    console.error('Pull blueprint error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}