import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { device } from "~/server/db/schemas/device";
import { user } from "~/server/db/schemas/user";
import { requireBlueprint } from "~/server/blueprint-access";

/** The history timeline. Newest first; docs are deliberately not included. */
export async function GET(request: Request, ctx: { params: Promise<{ blueprintId: string }> }) {
  const { blueprintId } = await ctx.params;
  const access = await requireBlueprint(request, blueprintId);
  if (access instanceof NextResponse) return access;

  const rows = await db
    .select({
      id: blueprintVersion.id,
      version: blueprintVersion.version,
      commitSha: blueprintVersion.commitSha,
      parentSha: blueprintVersion.parentSha,
      message: blueprintVersion.message,
      deviceId: blueprintVersion.deviceId,
      createdBy: blueprintVersion.createdBy,
      createdAt: blueprintVersion.createdAt,
    })
    .from(blueprintVersion)
    .where(eq(blueprintVersion.blueprintId, access.blueprint.id))
    .orderBy(desc(blueprintVersion.version));

  // Two small lookups instead of two joins per row — a history page is a handful of
  // distinct authors and devices however long the list gets.
  const deviceIds = [...new Set(rows.map((row) => row.deviceId).filter((id): id is string => !!id))];
  const userIds = [...new Set(rows.map((row) => row.createdBy))];

  const devices = deviceIds.length
    ? await db.select({ id: device.id, name: device.name, platform: device.platform }).from(device).where(inArray(device.id, deviceIds))
    : [];
  const users = userIds.length
    ? await db.select({ id: user.id, name: user.name, image: user.image }).from(user).where(inArray(user.id, userIds))
    : [];

  const deviceById = new Map(devices.map((row) => [row.id, row]));
  const userById = new Map(users.map((row) => [row.id, row]));

  return NextResponse.json({
    success: true,
    blueprint: { id: access.blueprint.id, name: access.blueprint.name, version: access.blueprint.version },
    versions: rows.map((row) => ({
      ...row,
      device: row.deviceId ? deviceById.get(row.deviceId) ?? null : null,
      author: userById.get(row.createdBy) ?? null,
    })),
  });
}
