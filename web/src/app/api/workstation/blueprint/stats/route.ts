import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { workstation } from "~/server/db/schemas/workstation";
import { eq, sql, and, gte } from "drizzle-orm";
import { auth } from "~/lib/auth";

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Get all blueprints for user's workstations
    const userWorkstations = await db
      .select({ id: workstation.id, name: workstation.name })
      .from(workstation)
      .where(eq(workstation.userId, userId));

    const workstationIds = userWorkstations.map((ws) => ws.id);

    if (workstationIds.length === 0) {
      return NextResponse.json({
        total: 0,
        active: 0,
        byWorkstation: {},
        recentActivity: [],
      });
    }

    // Get total count
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(blueprint)
      .where(
        sql`${blueprint.workstationId} IN (${sql.join(
          workstationIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );

    const total = Number(totalResult[0]?.count ?? 0);

    // Get count by workstation
    const byWorkstationResult = await db
      .select({
        workstationId: blueprint.workstationId,
        count: sql<number>`count(*)`,
      })
      .from(blueprint)
      .where(
        sql`${blueprint.workstationId} IN (${sql.join(
          workstationIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
      .groupBy(blueprint.workstationId);

    // Map workstation IDs to names
    const byWorkstation: Record<string, number> = {};
    for (const ws of userWorkstations) {
      const stat = byWorkstationResult.find((s) => s.workstationId === ws.id);
      if (stat) {
        byWorkstation[ws.name] = Number(stat.count);
      }
    }

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentActivityResult = await db
      .select({
        date: sql<string>`DATE(${blueprint.createdAt})`,
        count: sql<number>`count(*)`,
      })
      .from(blueprint)
      .where(
        and(
          sql`${blueprint.workstationId} IN (${sql.join(
            workstationIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          gte(blueprint.createdAt, sevenDaysAgo),
        ),
      )
      .groupBy(sql`DATE(${blueprint.createdAt})`)
      .orderBy(sql`DATE(${blueprint.createdAt})`);

    const recentActivity = recentActivityResult.map((row) => ({
      date: row.date,
      count: Number(row.count),
    }));

    // Count "active" blueprints (updated in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(blueprint)
      .where(
        and(
          sql`${blueprint.workstationId} IN (${sql.join(
            workstationIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          gte(blueprint.updatedAt, thirtyDaysAgo),
        ),
      );

    const active = Number(activeResult[0]?.count ?? 0);

    return NextResponse.json({
      total,
      active,
      byWorkstation,
      recentActivity,
    });
  } catch (error) {
    console.error("Error fetching blueprint stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch blueprint statistics" },
      { status: 500 },
    );
  }
}
