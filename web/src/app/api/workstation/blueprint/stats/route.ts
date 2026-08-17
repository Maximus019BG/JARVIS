import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { workstation } from "~/server/db/schemas/workstation";
import { eq, sql, and, gte } from "drizzle-orm";
import { auth } from "~/lib/auth";

/**
 * Blueprint stats for the dashboard card.
 *
 * This used to run five queries in sequence — the user's workstations, a total
 * count, a per-workstation count, a 7-day histogram and a 30-day "active" count —
 * each re-scanning `blueprint` with the same hand-built `IN (...)` list. Against
 * Neon us-east-1 that is five ~230ms round trips for one card.
 *
 * It is now two queries issued concurrently. Joining `workstation` scopes rows to
 * the user without a separate lookup, and a `FILTER` clause folds the "active"
 * count into the same GROUP BY, so `total` and `active` are sums over the groups.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // `gte(...)` rather than a raw comparison so the Date is bound through the
    // same Drizzle mapper the previous `where` clauses used.
    const perWorkstationQuery = db
      .select({
        workstationName: workstation.name,
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${gte(
          blueprint.updatedAt,
          thirtyDaysAgo,
        )})`,
      })
      .from(blueprint)
      .innerJoin(workstation, eq(blueprint.workstationId, workstation.id))
      .where(eq(workstation.userId, userId))
      .groupBy(workstation.id, workstation.name);

    const recentActivityQuery = db
      .select({
        date: sql<string>`DATE(${blueprint.createdAt})`,
        count: sql<number>`count(*)`,
      })
      .from(blueprint)
      .innerJoin(workstation, eq(blueprint.workstationId, workstation.id))
      .where(
        and(
          eq(workstation.userId, userId),
          gte(blueprint.createdAt, sevenDaysAgo),
        ),
      )
      .groupBy(sql`DATE(${blueprint.createdAt})`)
      .orderBy(sql`DATE(${blueprint.createdAt})`);

    const [perWorkstation, recentActivityRows] = await Promise.all([
      perWorkstationQuery,
      recentActivityQuery,
    ]);

    let total = 0;
    let active = 0;
    const byWorkstation: Record<string, number> = {};

    for (const row of perWorkstation) {
      const rowTotal = Number(row.total);
      total += rowTotal;
      active += Number(row.active);
      byWorkstation[row.workstationName] = rowTotal;
    }

    return NextResponse.json({
      total,
      active,
      byWorkstation,
      recentActivity: recentActivityRows.map((row) => ({
        date: row.date,
        count: Number(row.count),
      })),
    });
  } catch (error) {
    console.error("Error fetching blueprint stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch blueprint statistics" },
      { status: 500 },
    );
  }
}
