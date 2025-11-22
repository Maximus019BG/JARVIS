import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { eq, and } from "drizzle-orm";
import { decodeId, getEncryptionSecret } from "~/lib/crypto-utils";
import { workstation } from "~/server/db/schemas/workstation";
import { z } from "zod";
import { blueprintSaveSchema } from "~/lib/validation/blueprints";
import { auth } from "~/lib/auth";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ workstationId: string; blueprintId: string }> },
) {
  try {
    const { workstationId, blueprintId } = await ctx.params;
    // Parse and validate request body in one go
    const data = blueprintSaveSchema.parse(await _request.json());

  if (!workstationId) {
    return NextResponse.json(
      { error: "Workstation not found" },
      { status: 404 },
    );
  } else if (!blueprintId) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  // Get encryption secret from environment
  let secret: string;
  try {
    secret = getEncryptionSecret();
  } catch (error) {
    console.error("Encryption secret not configured:", error);
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  // Decode (or pass-through if not encrypted)
  const decodedWorkstationId = decodeId(workstationId, secret);
  const decodedBlueprintId = decodeId(blueprintId, secret);

  const session = await auth.api.getSession({
    headers: _request.headers,
  });

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workstationExists = await db
    .select()
    .from(workstation)
    .where(
      eq(workstation.id, decodedWorkstationId),
    )
    .limit(1);

  const workstationRecord = workstationExists[0];
  if (!workstationRecord || workstationExists.length === 0) {
    return NextResponse.json(
      { error: "Workstation not found" },
      { status: 404 },
    );
  }

  // Ensure session matches workstation owner
  if (session.user.id !== workstationRecord.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Save or update blueprint
  const existing = await db
    .select()
    .from(blueprint)
    .where(
      and(
        eq(blueprint.id, decodedBlueprintId),
        eq(blueprint.workstationId, decodedWorkstationId),
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
          eq(blueprint.id, decodedBlueprintId),
          eq(blueprint.workstationId, decodedWorkstationId),
        ),
      );
  } else {
    await db.insert(blueprint).values({
    id: decodedBlueprintId,
    name: data.name ?? "Untitled Blueprint",
    createdAt: new Date(),
    createdBy: workstationRecord.userId,
    metadata: data.data ? JSON.stringify(data.data) : null,
    workstationId: decodedWorkstationId,
    updatedAt: new Date(),

  });

  return NextResponse.json({ success: true });
  
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
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

