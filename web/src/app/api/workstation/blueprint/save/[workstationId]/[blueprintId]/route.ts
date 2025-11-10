import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { eq, and } from "drizzle-orm";
import { decodeId, getEncryptionSecret } from "~/lib/crypto-utils";
import { workstation } from "~/server/db/schemas/workstation";
import { z } from "zod";
import { blueprintSaveSchema } from "~/lib/validation/blueprints";

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

  // Save blueprint
  await db.insert(blueprint).values({
    id: decodedBlueprintId,
    name: data.name ?? "Untitled Blueprint",
    createdAt: new Date(),
    createdBy: workstationRecord.userId,
    metadata: data.data ? JSON.stringify(data.data) : null,
    workstationId: decodedWorkstationId,

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

