import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { eq, and } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: { workstationId: string; blueprintId: string } }
) {
  const { workstationId, blueprintId } = params;

  if (!workstationId) {
    return NextResponse.json({ error: "Workstation not found" }, { status: 404 });
  } else if (!blueprintId) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  // TODO: decode workstationId and blueprintId

  const data = await db
    .select()
    .from(blueprint)
    .where(
      and(
        eq(blueprint.id, blueprintId),
        eq(blueprint.workstationId, workstationId)
      )
    );

  return NextResponse.json(data);
}
