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

/**
 * Verify a device by looking up its ID in the database.
 *
 * This replaces JWT-based verification: the hardware only needs to know
 * its device ID (assigned via the web dashboard).  The server looks it up
 * in the DB and returns the associated workstationId / userId.
 *
 * Security is still enforced by HMAC request signing + replay protection.
 */
export async function verifyDeviceById(deviceId: string): Promise<DeviceClaims | null> {
  try {
    const deviceRecord = await db.query.device.findFirst({
      where: eq(device.id, deviceId),
    });

    if (!deviceRecord) {
      console.error('Device not found:', deviceId);
      return null;
    }

    if (!deviceRecord.isActive) {
      console.error('Device is inactive:', deviceId);
      return null;
    }

    return {
      deviceId: deviceRecord.id,
      workstationId: deviceRecord.workstationId,
      userId: deviceRecord.userId,
    };
  } catch (error) {
    console.error('Device verification by ID failed:', error);
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