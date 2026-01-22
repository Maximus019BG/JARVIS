import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { idempotencyKey } from '@/server/db/schemas/idempotencyKey';
import { eq, and, gt } from 'drizzle-orm';

const IDEMPOTENCY_EXPIRY_HOURS = 24;

export async function idempotency(request: NextRequest) {
  const idempotencyKey = request.headers.get('X-Idempotency-Key');
  const deviceId = request.headers.get('X-Device-Id');
  
  if (!idempotencyKey || !deviceId) {
    return NextResponse.next();
  }
  
  const existing = await db.query.idempotencyKey.findFirst({
    where: and(
      eq(idempotencyKey.key, idempotencyKey),
      eq(idempotencyKey.deviceId, deviceId),
      gt(idempotencyKey.expiresAt, new Date())
    )
  });
  
  if (existing) {
    return NextResponse.json(JSON.parse(existing.response), {
      status: 200,
      headers: {
        'X-Idempotency-Replayed': 'true'
      }
    });
  }
  
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_EXPIRY_HOURS * 60 * 60 * 1000);
  
  request.headers.set('X-Idempotency-Store', 'true');
  request.headers.set('X-Idempotency-Key', idempotencyKey);
  request.headers.set('X-Idempotency-Expires', expiresAt.toISOString());
  
  return NextResponse.next();
}

export async function storeIdempotencyResponse(
  request: NextRequest,
  response: NextResponse
) {
  if (request.headers.get('X-Idempotency-Store') !== 'true') {
    return;
  }
  
  const key = request.headers.get('X-Idempotency-Key')!;
  const deviceId = request.headers.get('X-Device-Id')!;
  const expiresAt = new Date(request.headers.get('X-Idempotency-Expires')!);
  
  await db.insert(idempotencyKey).values({
    key,
    deviceId,
    response: JSON.stringify(await response.json()),
    expiresAt
  });
}