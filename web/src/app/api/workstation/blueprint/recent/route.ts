import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { workstation } from "~/server/db/schemas/workstation";
import { eq, sql, desc } from "drizzle-orm";
import { auth } from "~/lib/auth";

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Get query parameters
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "10");

    // Get recent blueprints across all user's workstations
    const recentBlueprints = await db
      .select({
        id: blueprint.id,
        name: blueprint.name,
        workstationId: blueprint.workstationId,
        workstationName: workstation.name,
        createdBy: blueprint.createdBy,
        createdAt: blueprint.createdAt,
        updatedAt: blueprint.updatedAt,
      })
      .from(blueprint)
      .innerJoin(workstation, eq(blueprint.workstationId, workstation.id))
      .where(eq(workstation.userId, userId))
      .orderBy(desc(blueprint.updatedAt))
      .limit(limit);

    return NextResponse.json(recentBlueprints);
  } catch (error) {
    console.error("Error fetching recent blueprints:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent blueprints" },
      { status: 500 },
    );
  }
}
