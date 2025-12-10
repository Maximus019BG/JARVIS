import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { eq, and } from "drizzle-orm";
import { workstation } from "~/server/db/schemas/workstation";
import { blueprintSaveSchema } from "~/lib/validation/blueprints";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; blueprintId: string }> },
) {
  try {
    const { workstationId, blueprintId } = await ctx.params;
    const data = blueprintSaveSchema.parse(await request.json());

    if (!workstationId || !blueprintId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ws = await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, workstationId))
      .limit(1);

    if (ws.length === 0) {
      return NextResponse.json(
        { error: "Workstation not found" },
        { status: 404 },
      );
    }

    const existing = await db
      .select()
      .from(blueprint)
      .where(
        and(
          eq(blueprint.id, blueprintId),
          eq(blueprint.workstationId, workstationId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const existingBlueprint = existing[0]!;
      await db
        .update(blueprint)
        .set({
          name: data.name ?? existingBlueprint.name,
          metadata: data.data
            ? JSON.stringify(data.data)
            : existingBlueprint.metadata,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(blueprint.id, blueprintId),
            eq(blueprint.workstationId, workstationId),
          ),
        );

      return NextResponse.json({ success: true });
    }

    await db.insert(blueprint).values({
      id: blueprintId,
      name: data.name ?? "Untitled Blueprint",
      createdAt: new Date(),
      metadata: data.data ? JSON.stringify(data.data) : null,
      workstationId: workstationId,
      createdBy: existing[0]?.createdBy ?? workstationId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving blueprint:", error);
    return NextResponse.json(
      { error: "Failed to save blueprint" },
      { status: 500 },
    );
  }
}
