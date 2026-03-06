import { NextRequest, NextResponse } from 'next/server';
import { db } from '~/server/db';
import { device } from '~/server/db/schemas/device';
import { workstation } from '~/server/db/schemas/workstation';
import { user } from '~/server/db/schemas/user';
import { verifyDeviceToken } from '~/lib/device-auth';
import { verifyHMACSignature } from '~/lib/hmac-verify';
import { replayProtection } from '~/middleware/replay-protection';
import { eq } from 'drizzle-orm';

/**
 * GET /api/workstation/device/me
 *
 * Returns the user, workstation, and device information linked to the
 * calling hardware device.  Secured with the same device-auth chain
 * used by all /api/workstation/* endpoints (JWT + HMAC + replay).
 */
export async function GET(request: NextRequest) {
  try {
    // ── extract auth headers ──────────────────────────────────────
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    const deviceId = request.headers.get('X-Device-Id');
    const timestamp = request.headers.get('X-Timestamp');
    const nonce = request.headers.get('X-Nonce');
    const signature = request.headers.get('X-Signature');

    if (!token || !deviceId || !timestamp || !nonce || !signature) {
      return NextResponse.json(
        { error: 'Missing required headers' },
        { status: 400 },
      );
    }

    // ── replay protection ─────────────────────────────────────────
    const replayResult = await replayProtection(request);
    if (replayResult.status !== 200) {
      return replayResult;
    }

    // ── JWT verification ──────────────────────────────────────────
    const claims = await verifyDeviceToken(token);
    if (!claims || claims.deviceId !== deviceId) {
      return NextResponse.json(
        { error: 'Invalid device token' },
        { status: 401 },
      );
    }

    // ── HMAC signature verification ───────────────────────────────
    const hmacSecret = process.env.BLUEPRINT_SYNC_HMAC_SECRET;
    if (!hmacSecret) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 },
      );
    }

    // GET has no body; verify signature over empty payload ({})
    if (!verifyHMACSignature({}, timestamp, nonce, signature, hmacSecret)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 },
      );
    }

    // ── fetch device + workstation + user ─────────────────────────
    const deviceRecord = await db.query.device.findFirst({
      where: eq(device.id, deviceId),
    });

    if (!deviceRecord) {
      return NextResponse.json(
        { error: 'Device not found' },
        { status: 404 },
      );
    }

    const workstationRecord = await db.query.workstation.findFirst({
      where: eq(workstation.id, deviceRecord.workstationId),
    });

    const userRecord = await db.query.user.findFirst({
      where: eq(user.id, deviceRecord.userId),
    });

    // ── update lastSeenAt ─────────────────────────────────────────
    await db
      .update(device)
      .set({ lastSeenAt: new Date() })
      .where(eq(device.id, deviceId));

    // ── respond ───────────────────────────────────────────────────
    return NextResponse.json({
      user: userRecord
        ? {
            name: userRecord.name,
            email: userRecord.email,
            image: userRecord.image ?? null,
          }
        : null,
      workstation: workstationRecord
        ? {
            id: workstationRecord.id,
            name: workstationRecord.name,
          }
        : null,
      device: {
        id: deviceRecord.id,
        name: deviceRecord.name,
        lastSeenAt: deviceRecord.lastSeenAt,
      },
    });
  } catch (error) {
    console.error('Device /me error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
