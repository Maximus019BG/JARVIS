import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { deviceLink } from "~/server/db/schemas/device_link";
import { normaliseUserCode } from "~/server/device-auth";

const bodySchema = z.object({ userCode: z.string().min(8).max(16) });

/**
 * Turn down a pairing request.
 *
 * Deleting the row is the whole action: the device's next poll finds no link and reports
 * `expired_token`, which is already how it handles a request that went away.
 *
 * Only the addressed user may reject, and a row that is not theirs is reported as success
 * rather than 403 — a rejection endpoint that distinguished "not yours" from "not there"
 * would confirm the existence of other people's pending requests. Idempotent for the same
 * reason: rejecting twice is not an error worth surfacing.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  await db
    .delete(deviceLink)
    .where(
      and(
        eq(deviceLink.userCode, normaliseUserCode(body.userCode)),
        eq(deviceLink.targetUserId, session.user.id),
      ),
    );

  return NextResponse.json({ success: true });
}
