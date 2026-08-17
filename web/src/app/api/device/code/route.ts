import { lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "~/env";
import { db } from "~/server/db";
import { deviceLink } from "~/server/db/schemas/device_link";
import {
  CODE_TTL_MS,
  newDeviceCode,
  newUserCode,
  POLL_INTERVAL_SECONDS,
  sha256,
} from "~/server/device-auth";

const bodySchema = z.object({
  name: z.string().min(1).max(64),
  fingerprint: z.string().min(4).max(128),
  platform: z.string().max(64).optional(),
});

/**
 * Step one of RFC 8628. Unauthenticated by design — anyone can *ask* to pair; nothing
 * happens until a signed-in human approves the request and sees the fingerprint.
 */
export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Cheap opportunistic sweep: expired requests are useless and a stale user code must
  // not stay claimable. Saves needing a scheduled job for a table this small.
  await db.delete(deviceLink).where(lt(deviceLink.expiresAt, new Date()));

  const userCode = newUserCode();
  const deviceCode = newDeviceCode();

  await db.insert(deviceLink).values({
    userCode,
    deviceCodeHash: sha256(deviceCode),
    name: body.name,
    fingerprint: body.fingerprint,
    platform: body.platform ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const base = env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "");
  return NextResponse.json({
    userCode,
    deviceCode,
    verificationUri: `${base}/link`,
    verificationUriComplete: `${base}/link?code=${encodeURIComponent(userCode)}`,
    expiresIn: Math.floor(CODE_TTL_MS / 1000),
    interval: POLL_INTERVAL_SECONDS,
  });
}
