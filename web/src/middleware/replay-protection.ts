import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { nonce } from '@/server/db/schemas/nonce';
import { eq, and, gt } from 'drizzle-orm';

const NONCE_EXPIRY_SECONDS = 300;
const TIMESTAMP_TOLERANCE_SECONDS = 300;

export async function replayProtection(request: NextRequest) {
  const deviceId = request.headers.get('X-Device-Id');
  const timestamp = request.headers.get('X-Timestamp');
  const nonceValue = request.headers.get('X-Nonce');
  
  if (!deviceId || !timestamp || !nonceValue) {
    return NextResponse.json(
      { error: 'Missing replay protection headers' },
      { status: 400 }
    );
  }
  
  const requestTime = new Date(timestamp).getTime();
  const now = Date.now();
  
  if (Math.abs(now - requestTime) > TIMESTAMP_TOLERANCE_SECONDS * 1000) {
    return NextResponse.json(
      { error: 'Timestamp outside valid range' },
      { status: 400 }
    );
  }
  
  const existingNonce = await db.query.nonce.findFirst({
    where: and(
      eq(nonce.value, nonceValue),
      eq(nonce.deviceId, deviceId),
      gt(nonce.expiresAt, new Date())
    )
  });
  
  if (existingNonce) {
    return NextResponse.json(
      { error: 'Replay attack detected' },
      { status: 403 }
    );
  }
  
  const expiresAt = new Date(Date.now() + NONCE_EXPIRY_SECONDS * 1000);
  await db.insert(nonce).values({
    value: nonceValue,
    deviceId,
    expiresAt
  });
  
  // Clean up expired nonces periodically
  await db.delete(nonce).where(
    gt(nonce.expiresAt, new Date())
  );
  
  return NextResponse.next();
}