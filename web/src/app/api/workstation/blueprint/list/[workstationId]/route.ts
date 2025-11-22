import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { workstation } from "~/server/db/schemas/workstation";
import { eq, and, sql } from "drizzle-orm";
import { decodeId, getEncryptionSecret } from "~/lib/crypto-utils";
import { auth } from "~/lib/auth";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ workstationId: string }> },
) {
  const { workstationId } = await ctx.params;
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!workstationId)
    return NextResponse.json(
      { error: "Workstation not found" },
      { status: 404 },
    );

  let secret: string;
  try {
    secret = getEncryptionSecret();
  } catch (error) {
    console.error("Encryption secret not configured", error);
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  const decodedWorkstationId = decodeId(workstationId, secret);

  const workstationRecord = (
    await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, decodedWorkstationId))
      .limit(1)
  )[0];
  if (!workstationRecord || workstationRecord.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const recentOnly = searchParams.get("recentOnly") === "true";

  let query = db
    .select()
    .from(blueprint)
    .where(eq(blueprint.workstationId, decodedWorkstationId));

  if (recentOnly) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    query = db
      .select()
      .from(blueprint)
      .where(
        and(
          eq(blueprint.workstationId, decodedWorkstationId),
          sql`(${blueprint.updatedAt} >= ${cutoff.toISOString()})`,
        ),
      );
  }

  const rows = await query;

  return NextResponse.json(
    rows.map((r: any) => ({
      ...r,
      lastModified: r.updatedAt ?? r.createdAt,
    })),
  );
}
