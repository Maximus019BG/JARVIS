import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { decodeId, getEncryptionSecret } from "~/lib/crypto-utils";
import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { deviceGrant } from "~/server/db/schemas/device_grant";
import { workstation } from "~/server/db/schemas/workstation";

/** Devices paired to one workstation, each with its access summary. */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = new URL(request.url).searchParams.get("workstationId");
  if (!raw) return NextResponse.json({ error: "workstationId is required" }, { status: 400 });

  let secret: string;
  try {
    secret = getEncryptionSecret();
  } catch {
    return NextResponse.json({ error: "Server config" }, { status: 500 });
  }

  const workstationId = decodeId(raw, secret);
  const owned = (
    await db.select().from(workstation).where(eq(workstation.id, workstationId)).limit(1)
  )[0];
  if (!owned || owned.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const devices = await db.select().from(device).where(eq(device.workstationId, workstationId));
  const grants =
    devices.length > 0
      ? await db
          .select()
          .from(deviceGrant)
          .where(inArray(deviceGrant.deviceId, devices.map((row) => row.id)))
      : [];

  return NextResponse.json({
    success: true,
    devices: devices.map((row) => {
      const mine = grants.filter((grant) => grant.deviceId === row.id);
      const all = mine.find((grant) => grant.blueprintId === null);
      return {
        id: row.id,
        name: row.name,
        platform: row.platform,
        fingerprint: row.fingerprint,
        tokenPrefix: row.tokenPrefix,
        status: row.status,
        // A device that was approved but has never polled has no token yet — worth
        // showing, because it looks broken otherwise.
        paired: row.tokenHash !== null,
        lastSeenAt: row.lastSeenAt,
        approvedAt: row.approvedAt,
        createdAt: row.createdAt,
        access: all
          ? { scope: "all" as const, mode: all.mode }
          : {
              scope: "some" as const,
              mode: mine.some((grant) => grant.mode === "write") ? "write" : "read",
              blueprintIds: mine.map((grant) => grant.blueprintId!).filter(Boolean),
            },
      };
    }),
  });
}
