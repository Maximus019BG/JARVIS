import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { canDeleteDevice } from "~/server/device-auth";
import { ownedDevice } from "~/server/owned-device";

/**
 * The device row itself — rename it, or remove it for good. The sibling routes each own one
 * facet (`scopes`, `grants`, `revoke`); this one owns the record.
 */

const bodySchema = z.object({ name: z.string().trim().min(1).max(64) });

/**
 * Renames a device. Same 1–64 trimmed bound as the mint route, so a rename cannot produce a
 * name that creating the token would have rejected.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;

  const owned = await ownedDevice(request, deviceId);
  if (owned instanceof NextResponse) return owned;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  await db.update(device).set({ name: body.name }).where(eq(device.id, deviceId));

  return NextResponse.json({ success: true, name: body.name });
}

/**
 * Deletes a device permanently, but only one that is already revoked — see `canDeleteDevice`.
 *
 * Safe to cascade: every foreign key onto `device.id` is either `set null` (the history tables
 * — `blueprint_version`, `sync_log`, `agent_session`, …, which keep their rows and simply stop
 * naming a device) or `cascade` (the ephemeral ones — grants, approvals, nonces, idempotency
 * keys, pairing links).
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;

  const owned = await ownedDevice(request, deviceId);
  if (owned instanceof NextResponse) return owned;

  if (!canDeleteDevice(owned.device.status)) {
    return NextResponse.json({ error: "not_revoked" }, { status: 409 });
  }

  await db.delete(device).where(eq(device.id, deviceId));

  return NextResponse.json({ success: true });
}
