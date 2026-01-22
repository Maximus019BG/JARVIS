import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { device } from '@/server/db/schemas/device';
import { workstation } from '@/server/db/schemas/workstation';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { generateDeviceToken } from '@/lib/device-auth';
import { nanoid } from 'nanoid';

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { workstationId, deviceName } = body;

    if (!workstationId || !deviceName) {
      return NextResponse.json(
        { error: 'workstationId and deviceName are required' },
        { status: 400 }
      );
    }

    // Verify workstation ownership
    const ws = await db.query.workstation.findFirst({
      where: eq(workstation.id, workstationId)
    });

    if (!ws || ws.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Workstation not found or access denied' },
        { status: 404 }
      );
    }

    // Generate device ID and token
    const deviceId = nanoid();
    const deviceToken = generateDeviceToken({
      deviceId,
      workstationId,
      userId: session.user.id
    });

    // Store device
    await db.insert(device).values({
      id: deviceId,
      name: deviceName,
      workstationId,
      userId: session.user.id,
      deviceToken,
      isActive: true
    });

    return NextResponse.json({
      success: true,
      deviceId,
      deviceToken
    });
  } catch (error) {
    console.error('Device registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}