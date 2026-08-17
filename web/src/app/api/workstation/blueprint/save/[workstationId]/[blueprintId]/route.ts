import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { eq, and } from "drizzle-orm";
import { workstation } from "~/server/db/schemas/workstation";
import { z } from "zod";
import { blueprintSaveSchema } from "~/lib/validation/blueprints";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ workstationId: string; blueprintId: string }> },
) {
  try {
    const { workstationId, blueprintId } = await ctx.params;

    // This route used to be deliberately unauthenticated — "the device authenticates by
    // providing the workstation ID" — which meant anyone holding an id could write. Devices
    // now have real bearer tokens and use /api/blueprint/push, so this path is
    // browser-only and requires a session plus ownership of the workstation below.
    const session = await auth.api.getSession({ headers: _request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate request body in one go
    const data = blueprintSaveSchema.parse(await _request.json());

    if (!workstationId) {
      return NextResponse.json(
        { error: "Workstation not found" },
        { status: 404 },
      );
    }

    if (!blueprintId) {
      return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
    }

    // Decode (or pass-through if not encrypted)

    const workstationExists = await db
      .select()
      .from(workstation)
      .where(
        eq(workstation.id, workstationId),
      )
      .limit(1);

    const workstationRecord = workstationExists[0];
    if (!workstationRecord || workstationExists.length === 0) {
      return NextResponse.json(
        { error: "Workstation not found" },
        { status: 404 },
      );
    }

    if (workstationRecord.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Save or update blueprint
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
      await db
        .update(blueprint)
        .set({
          name: data.name ?? (existing[0] as any).name,
          metadata: data.data ? JSON.stringify(data.data) : (existing[0] as any).metadata,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(blueprint.id, blueprintId),
            eq(blueprint.workstationId, workstationId),
          ),
        );

      return NextResponse.json({ success: true });
    } else {
      await db.insert(blueprint).values({
        id: blueprintId,
        name: data.name ?? "Untitled Blueprint",
        createdAt: new Date(),
        createdBy: workstationRecord.userId,
        metadata: data.data ? JSON.stringify(data.data) : null,
        workstationId: workstationId,
        updatedAt: new Date(),
      });

      return NextResponse.json({ success: true });
    }
  } catch (error) {
    // Handle DNS / network errors that commonly happen when the DB host cannot be resolved
    if ((error as any)?.code === "ENOTFOUND" || (typeof (error as any)?.message === "string" && (error as any).message.includes("ENOTFOUND"))) {
      console.error("Network/DNS error while accessing DB host:", error);
      return NextResponse.json(
        { error: "Database host not found (DNS resolution failed)" },
        { status: 502 },
      );
    }
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 },
      );
    }

    // Handle JSON parsing errors
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    // Handle other errors
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}