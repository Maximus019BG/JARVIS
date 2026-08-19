import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { requireBlueprint } from "~/server/blueprint-access";
import { docFromMetadata } from "~/server/blueprint-legacy";

/**
 * The current document, already converted if the row still holds the old web-editor blob —
 * so the editor and the viewer never see two formats, and the ids they hand back to
 * `/edit` are the ids the server will apply ops against.
 */
export async function GET(request: Request, ctx: { params: Promise<{ blueprintId: string }> }) {
  const { blueprintId } = await ctx.params;
  const access = await requireBlueprint(request, blueprintId);
  if (access instanceof NextResponse) return access;

  const { doc, converted } = docFromMetadata(access.blueprint.metadata, access.blueprint.name);
  return NextResponse.json({
    success: true,
    id: access.blueprint.id,
    name: access.blueprint.name,
    workstationId: access.blueprint.workstationId,
    version: access.blueprint.version,
    syncStatus: access.blueprint.syncStatus,
    updatedAt: access.blueprint.updatedAt,
    /** Null when the row has no content or content nothing can read. */
    doc,
    /** True when the row still holds the old web-editor blob and this is a conversion. */
    legacy: converted,
  });
}

/** Versions and sync logs are `onDelete: "cascade"`, so the row is the whole job. */
export async function DELETE(request: Request, ctx: { params: Promise<{ blueprintId: string }> }) {
  const { blueprintId } = await ctx.params;
  const access = await requireBlueprint(request, blueprintId);
  if (access instanceof NextResponse) return access;

  await db.delete(blueprint).where(eq(blueprint.id, access.blueprint.id));
  return NextResponse.json({ success: true });
}
