import crypto from 'crypto';

export function verifyHMACSignature(
  payload: any,
  timestamp: string,
  nonce: string,
  signature: string,
  secret: string
): boolean {
  const canonical = {
    timestamp,
    nonce,
    payload
  };

  const payloadString = JSON.stringify(canonical, Object.keys(canonical).sort());

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');

  // timingSafeEqual throws if buffer lengths differ; treat as invalid signature.
  try {
    const provided = Buffer.from(signature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}