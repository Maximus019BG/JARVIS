import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { deviceLink } from "~/server/db/schemas/device_link";
import { workstation } from "~/server/db/schemas/workstation";

/**
 * Pairing requests waiting for *this* user, so approving one costs a tap rather than
 * transcribing a code.
 *
 * Scoped to `target_user_id` and never wider. A global list of everything unapproved would
 * be a phishing hole: `POST /api/device/code` is unauthenticated, so anyone could make a
 * row appear in somebody else's list and hope for a careless click. Addressing narrows the
 * blast radius to people who know your email; the fingerprint the UI shows is what closes
 * the rest of the gap, which is why it is returned first-class and not as a detail.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const links = await db
    .select()
    .from(deviceLink)
    .where(
      and(
        eq(deviceLink.targetUserId, session.user.id),
        isNull(deviceLink.approvedDeviceId),
        gt(deviceLink.expiresAt, new Date()),
      ),
    );

  if (links.length === 0) return NextResponse.json({ success: true, requests: [] });

  // "Have I approved this exact machine before?" — a reflashed Pi should not read the same
  // as a box nobody here has ever seen. One query over the caller's own devices; a
  // fingerprint from anyone else's workstation must not count as familiar.
  const mine = await db
    .select({ id: workstation.id })
    .from(workstation)
    .where(eq(workstation.userId, session.user.id));
  const known = new Set(
    mine.length === 0
      ? []
      : (
          await db
            .select({ fingerprint: device.fingerprint })
            .from(device)
            .where(inArray(device.workstationId, mine.map((row) => row.id)))
        )
          .map((row) => row.fingerprint)
          .filter((value): value is string => value !== null),
  );

  return NextResponse.json({
    success: true,
    requests: links
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((link) => ({
        userCode: link.userCode,
        name: link.name,
        fingerprint: link.fingerprint,
        platform: link.platform,
        knownFingerprint: known.has(link.fingerprint),
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
      })),
  });
}
