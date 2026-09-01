import { lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { env } from "~/env";
import { db } from "~/server/db";
import { deviceLink } from "~/server/db/schemas/device_link";
import { user } from "~/server/db/schemas/user";
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
  /** Who should be offered this request in their Devices tab. Optional — see below. */
  email: z.string().email().max(255).optional(),
});

/**
 * Step one of RFC 8628. Unauthenticated by design — anyone can *ask* to pair; nothing
 * happens until a signed-in human approves the request and sees the fingerprint.
 *
 * `email` only decides whose pending list the request appears in. An address that matches
 * no account is not an error and does not change the response by a single field: this
 * endpoint is unauthenticated, so any difference between "known" and "unknown" would make
 * it an oracle for testing which addresses are registered. An unmatched email simply
 * leaves `target_user_id` null, and the request stays reachable by its code alone.
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

  const targetUserId = body.email
    ? ((
        await db
          .select({ id: user.id })
          .from(user)
          // Case-insensitive: someone typing `Me@Example.com` into the wizard means the
          // same account, and nothing guarantees how the address was cased at signup.
          .where(sql`lower(${user.email}) = ${body.email.toLowerCase()}`)
          .limit(1)
      )[0]?.id ?? null)
    : null;

  const userCode = newUserCode();
  const deviceCode = newDeviceCode();

  await db.insert(deviceLink).values({
    userCode,
    deviceCodeHash: sha256(deviceCode),
    name: body.name,
    fingerprint: body.fingerprint,
    platform: body.platform ?? null,
    targetUserId,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const base = env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "");
  const verificationUriComplete = `${base}/link?code=${encodeURIComponent(userCode)}`;

  return NextResponse.json({
    userCode,
    deviceCode,
    verificationUri: `${base}/link`,
    verificationUriComplete,
    // Rendered here rather than on the device: `qrcode` is already a dependency of the web
    // app, so this costs the TUI no new package and keeps one implementation. ~1.3 KB.
    qr: await QRCode.toString(verificationUriComplete, { type: "terminal", small: true }),
    expiresIn: Math.floor(CODE_TTL_MS / 1000),
    interval: POLL_INTERVAL_SECONDS,
  });
}
