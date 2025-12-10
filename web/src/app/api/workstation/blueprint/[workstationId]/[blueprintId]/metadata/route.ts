import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { decodeId, getEncryptionSecret } from "~/lib/crypto-utils";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { workstation } from "~/server/db/schemas/workstation";

type RouteContext = {
  params: Promise<{
    workstationId: string;
    blueprintId: string;
  }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { workstationId, blueprintId } = await context.params;

    if (!workstationId || !blueprintId) {
      return NextResponse.json(
        { error: "Invalid request parameters" },
        { status: 400 },
      );
    }

    // Ensure request is authenticated
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Decode IDs using configured secret (pass-through when not encrypted)
    const secret = getEncryptionSecret();
    const decodedWorkstationId = decodeId(workstationId, secret);
    const decodedBlueprintId = decodeId(blueprintId, secret);

    // Verify workstation belongs to user
    const ws = await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, decodedWorkstationId))
      .limit(1);

    if (!ws[0] || ws[0].userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch blueprint with workstation and ownership validation
    const rows = await db
      .select({
        metadata: blueprint.metadata,
        name: blueprint.name,
      })
      .from(blueprint)
      .where(
        and(
          eq(blueprint.id, decodedBlueprintId),
          eq(blueprint.workstationId, decodedWorkstationId),
        ),
      )
      .limit(1);

    const row = rows[0];

    if (!row) {
      return NextResponse.json(
        { error: "Blueprint not found" },
        { status: 404 },
      );
    }

    let metadata: unknown = row.metadata;
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

    if (metadata === null || typeof metadata !== "object") {
      return NextResponse.json(
        { error: "Metadata is not a JSON object" },
        { status: 500 },
      );
    }

    return NextResponse.json({ metadata, name: row.name });
  } catch (error) {
    console.error("Error fetching blueprint metadata:", error);
    return NextResponse.json(
      { error: "Failed to fetch blueprint metadata" },
      { status: 500 },
    );
  }
}
