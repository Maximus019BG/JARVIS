import { db } from '~/server/db';
import { device } from '~/server/db/schemas/device';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

export interface DeviceClaims {
  deviceId: string;
  workstationId: string;
  userId: string;
}

export async function verifyDeviceToken(token: string): Promise<DeviceClaims | null> {
  try {
    const secret = process.env.BLUEPRINT_SYNC_JWT_SECRET;
    if (!secret) {
      console.error('BLUEPRINT_SYNC_JWT_SECRET not configured');
      return null;
    }

    const decoded = jwt.verify(token, secret) as DeviceClaims;
    
    // Verify device exists and is active
    const deviceRecord = await db.query.device.findFirst({
      where: eq(device.id, decoded.deviceId)
    });

    if (!deviceRecord || !deviceRecord.isActive) {
      return null;
    }

    return decoded;
  } catch (error) {
    console.error('Device token verification failed:', error);
    return null;
  }
}

export function generateDeviceToken(claims: DeviceClaims): string {
  const secret = process.env.BLUEPRINT_SYNC_JWT_SECRET;
  if (!secret) {
    throw new Error('BLUEPRINT_SYNC_JWT_SECRET not configured');
  }

  const expiryHours = parseInt(process.env.DEVICE_TOKEN_EXPIRY_HOURS || '8760', 10);
  
  return jwt.sign(claims, secret, {
    expiresIn: `${expiryHours}h`
  });
}