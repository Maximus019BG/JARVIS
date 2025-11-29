import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { eq, and } from "drizzle-orm";
import { decodeId, getEncryptionSecret } from "~/lib/crypto-utils";
import { auth } from "~/lib/auth";
import { workstation } from "~/server/db/schemas/workstation";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ workstationId: string; blueprintId: string }> },
) {
  const { workstationId, blueprintId } = await ctx.params;

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

  const session = await auth.api.getSession({ headers: _request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Decode (or pass-through if not encrypted)
  const decodedWorkstationId = decodeId(workstationId, secret);
  const decodedBlueprintId = decodeId(blueprintId, secret);

  // Ensure workstation belongs to user
  const ws = (
    await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, decodedWorkstationId))
      .limit(1)
  )[0];
  if (!ws || ws.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Query - select one record
  const data = await db
    .select()
    .from(blueprint)
    .where(
      and(
        eq(blueprint.id, decodedBlueprintId),
        eq(blueprint.workstationId, decodedWorkstationId),
      ),
    )
    .limit(1);

  const record = data[0];

  if (!record) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  // Ensure we return a JSON object (not a JSON string)
  type BlueprintRow = { metadata: unknown };
  let metadata: unknown = (record as BlueprintRow).metadata;
  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return NextResponse.json(
        { error: "Invalid metadata format in database" },
        { status: 500 },
      );
    }
  }

  // Optionally, validate it's an object
  if (metadata === null || typeof metadata !== "object") {
    return NextResponse.json(
      { error: "Metadata is not a JSON object" },
      { status: 500 },
    );
  }

  return NextResponse.json(metadata);
}
