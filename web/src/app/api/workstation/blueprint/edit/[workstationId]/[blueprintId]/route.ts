import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { eq, and } from "drizzle-orm";
import { workstation } from "~/server/db/schemas/workstation";
import { blueprintSaveSchema } from "~/lib/validation/blueprints";
import { auth } from "~/lib/auth";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; blueprintId: string }> },
) {
  try {
    const { workstationId, blueprintId } = await ctx.params;

    // Was unauthenticated: any caller who knew a workstation id could write. Devices now
    // authenticate with bearer tokens against /api/blueprint/push, so this is a
    // browser-only path and needs a session plus ownership.
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = blueprintSaveSchema.parse(await request.json());

    if (!workstationId || !blueprintId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ws = await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, workstationId))
      .limit(1);

    const workstationRecord = ws[0];
    if (!workstationRecord) {
      return NextResponse.json(
        { error: "Workstation not found" },
        { status: 404 },
      );
    }
    if (workstationRecord.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      // Was `workstationId`, which is not a user id — the FK to `user` would reject it.
      createdBy: session.user.id,
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
