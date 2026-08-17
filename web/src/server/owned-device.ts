import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { ownsWorkstation } from "~/server/ownership";

/**
 * The guard every `/api/device/[deviceId]/…` route needs: is there a signed-in user, does the
 * device exist, and does that user own the workstation it belongs to.
 *
 * It lived as a copy in each route, re-inlined by hand and already drifting — `scopes` went
 * through `ownsWorkstation` while `grants` and `revoke` compared `workstation.userId` inline.
 * Duplicated auth is the kind that drifts into a hole, so there is one copy now.
 *
 * Unlike `~/server/ownership`, this does import better-auth and returns a `NextResponse`, so it
 * is only usable from a route handler. That is deliberate: the tenancy rule stays in
 * `ownership.ts` where a device token can reach it too, and only the HTTP shell is here.
 */
export async function ownedDevice(
  request: Request,
  deviceId: string,
): Promise<{ device: typeof device.$inferSelect; userId: string } | NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = (await db.select().from(device).where(eq(device.id, deviceId)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await ownsWorkstation(session.user.id, target.workstationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The user id comes back too: `grants` needs it for `createdBy`, and re-reading the session
  // a line later to get it would be the start of the same drift this module ends.
  return { device: target, userId: session.user.id };
}
