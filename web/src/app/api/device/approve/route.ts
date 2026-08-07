import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { device } from "~/server/db/schemas/device";
import { deviceGrant } from "~/server/db/schemas/device_grant";
import { deviceLink } from "~/server/db/schemas/device_link";
import { workstation } from "~/server/db/schemas/workstation";
import { normaliseUserCode } from "~/server/device-auth";

const bodySchema = z.object({
  userCode: z.string().min(8).max(16),
  workstationId: z.string().min(1),
  /** Rename the device at approval time; defaults to what it called itself. */
  name: z.string().min(1).max(64).optional(),
  /** Empty array plus `allBlueprints: false` is a device that can reach nothing. */
  blueprintIds: z.array(z.string()).default([]),
  allBlueprints: z.boolean().default(false),
  mode: z.enum(["read", "write"]).default("write"),
});

/** Lookup for the approval screen: what is asking, so the user can recognise it. */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const code = normaliseUserCode(new URL(request.url).searchParams.get("code") ?? "");
  if (code.length !== 9) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  const rows = await db.select().from(deviceLink).where(eq(deviceLink.userCode, code)).limit(1);
  const link = rows[0];
  if (!link || link.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "expired_or_unknown" }, { status: 404 });
  }
  if (link.approvedDeviceId) return NextResponse.json({ error: "already_approved" }, { status: 409 });

  return NextResponse.json({
    request: {
      name: link.name,
      fingerprint: link.fingerprint,
      platform: link.platform,
      expiresAt: link.expiresAt,
    },
  });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const workstationId = body.workstationId;
  const owned = (
    await db.select().from(workstation).where(eq(workstation.id, workstationId)).limit(1)
  )[0];
  if (!owned || owned.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const code = normaliseUserCode(body.userCode);
  const link = (await db.select().from(deviceLink).where(eq(deviceLink.userCode, code)).limit(1))[0];
  if (!link || link.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "expired_or_unknown" }, { status: 404 });
  }
  if (link.approvedDeviceId) return NextResponse.json({ error: "already_approved" }, { status: 409 });

  // Every named blueprint must live in the workstation being granted. Otherwise the
  // approval screen becomes a way to hand a device access to somebody else's drawing.
  const requested = [...new Set(body.blueprintIds.map((id) => id))];
  if (requested.length > 0) {
    const found = await db
      .select({ id: blueprint.id })
      .from(blueprint)
      .where(and(eq(blueprint.workstationId, workstationId)));
    const allowed = new Set(found.map((row) => row.id));
    if (requested.some((id) => !allowed.has(id))) {
      return NextResponse.json({ error: "blueprint_not_in_workstation" }, { status: 400 });
    }
  }

  const deviceId = `dev_${nanoid(16)}`;
  const now = new Date();

  // No token here on purpose: the device mints one on its next poll, so nothing readable
  // is ever stored. See src/app/api/device/token/route.ts.
  await db.insert(device).values({
    id: deviceId,
    name: body.name ?? link.name,
    workstationId,
    userId: session.user.id,
    fingerprint: link.fingerprint,
    platform: link.platform,
    status: "active",
    approvedBy: session.user.id,
    approvedAt: now,
    createdAt: now,
  });

  const grants = body.allBlueprints
    ? [{ blueprintId: null }]
    : requested.map((blueprintId) => ({ blueprintId }));
  if (grants.length > 0) {
    await db.insert(deviceGrant).values(
      grants.map((grant) => ({
        id: `grt_${nanoid(16)}`,
        deviceId,
        blueprintId: grant.blueprintId,
        mode: body.mode,
        createdBy: session.user.id,
        createdAt: now,
      })),
    );
  }

  await db.update(deviceLink).set({ approvedDeviceId: deviceId }).where(eq(deviceLink.userCode, code));

  return NextResponse.json({
    success: true,
    device: { id: deviceId, name: body.name ?? link.name, grants: grants.length },
  });
}
