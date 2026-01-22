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
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}