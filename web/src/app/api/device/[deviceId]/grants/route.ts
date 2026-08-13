import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { device } from "~/server/db/schemas/device";
import { deviceGrant } from "~/server/db/schemas/device_grant";
import { workstation } from "~/server/db/schemas/workstation";

const bodySchema = z.object({
  blueprintIds: z.array(z.string()).default([]),
  allBlueprints: z.boolean().default(false),
  mode: z.enum(["read", "write"]).default("write"),
});

/**
 * Replaces a device's whole grant set. Replace rather than merge: "these are the
 * blueprints this Pi can touch" is the question the UI asks, and a merge would make
 * unticking a box do nothing.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;

  //Get session and check if user is logged in
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  //Check if device exists and if user owns the workstation the device is in
  const target = (await db.select().from(device).where(eq(device.id, deviceId)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  //Check if user owns the workstation the device is in
  const owned = (await db.select().from(workstation).where(eq(workstation.id, target.workstationId)).limit(1))[0];
  if (owned?.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requested = [...new Set(body.blueprintIds.map((id) => id))];
  if (requested.length > 0) {
    const found = await db
      .select({ id: blueprint.id })
      .from(blueprint)
      .where(eq(blueprint.workstationId, target.workstationId));
    const allowed = new Set(found.map((row) => row.id));
    if (requested.some((id) => !allowed.has(id))) {
      return NextResponse.json({ error: "blueprint_not_in_workstation" }, { status: 400 });
    }
  }

  const rows = body.allBlueprints
    ? [{ blueprintId: null as string | null }]
    : requested.map((blueprintId) => ({ blueprintId: blueprintId }));

  await db.transaction(async (tx) => {
    await tx.delete(deviceGrant).where(eq(deviceGrant.deviceId, deviceId));
    if (rows.length > 0) {
      await tx.insert(deviceGrant).values(
        rows.map((row) => ({
          id: `grt_${nanoid(16)}`,
          deviceId,
          blueprintId: row.blueprintId,
          mode: body.mode,
          createdBy: session.user.id,
          createdAt: new Date(),
        })),
      );
    }
  });

  return NextResponse.json({ success: true, grants: rows.length });
}

/** What this device can reach right now. */
export async function GET(request: Request, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = (await db.select().from(device).where(eq(device.id, deviceId)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const owned = (
    await db.select().from(workstation).where(eq(workstation.id, target.workstationId)).limit(1)
  )[0];
  if (owned?.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const grants = await db
    .select()
    .from(deviceGrant)
    .where(and(eq(deviceGrant.deviceId, deviceId)));

  return NextResponse.json({
    success: true,
    allBlueprints: grants.some((grant) => grant.blueprintId === null),
    mode: grants.some((grant) => grant.mode === "write") ? "write" : "read",
    blueprintIds: grants.map((grant) => grant.blueprintId).filter((id): id is string => id !== null),
  });
}
