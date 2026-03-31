import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { syncLog } from "~/server/db/schemas/sync_log";
import { device } from "~/server/db/schemas/device";
import { workstation } from "~/server/db/schemas/workstation";
import { auth } from "~/lib/auth";
import { eq, sql, gte, and } from "drizzle-orm";

/**
 * GET /api/workstation/device/usage
 *
 * Returns API request (sync_log) counts broken down by device and by
 * action type.  Authenticated via user session (web dashboard).
 *
 * Optional query parameters:
 *   - workstationId  – restrict to a single workstation
 *   - days           – look-back window in days (default: 30)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const url = new URL(request.url);
    const workstationIdFilter = url.searchParams.get("workstationId");
    const daysBack = Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10));

    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    // Resolve the workstations owned by this user
    const userWorkstations = await db
      .select({ id: workstation.id, name: workstation.name })
      .from(workstation)
      .where(eq(workstation.userId, userId));

    const allowedIds = userWorkstations.map((ws) => ws.id);

    if (allowedIds.length === 0) {
      return NextResponse.json({ requests: [], totalRequests: 0 });
    }

    // Filter to a specific workstation if requested (ownership enforced)
    const targetWorkstationIds = workstationIdFilter
      ? allowedIds.filter((id) => id === workstationIdFilter)
      : allowedIds;

    if (targetWorkstationIds.length === 0) {
      return NextResponse.json({ error: "Workstation not found" }, { status: 404 });
    }

    // Fetch all devices in the relevant workstations
    const devices = await db
      .select({ id: device.id, name: device.name, workstationId: device.workstationId })
      .from(device)
      .where(
        sql`${device.workstationId} IN (${sql.join(
          targetWorkstationIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );

    const deviceIds = devices.map((d) => d.id);

    if (deviceIds.length === 0) {
      return NextResponse.json({ requests: [], totalRequests: 0 });
    }

    // Count requests per device per action within the time window
    const counts = await db
      .select({
        deviceId: syncLog.deviceId,
        action: syncLog.action,
        count: sql<number>`count(*)`,
      })
      .from(syncLog)
      .where(
        and(
          sql`${syncLog.deviceId} IN (${sql.join(
            deviceIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          gte(syncLog.createdAt, since),
        ),
      )
      .groupBy(syncLog.deviceId, syncLog.action);

    // Build a lookup: deviceId -> { deviceName, workstationId }
    const deviceMap = new Map(
      devices.map((d) => [d.id, { name: d.name, workstationId: d.workstationId }]),
    );
    const workstationNameMap = new Map(
      userWorkstations.map((ws) => [ws.id, ws.name]),
    );

    // Aggregate totals per device
    const perDevice: Record<
      string,
      {
        deviceId: string;
        deviceName: string;
        workstationId: string;
        workstationName: string;
        totalRequests: number;
        byAction: Record<string, number>;
      }
    > = {};

    for (const row of counts) {
      const did = row.deviceId ?? "";
      const info = deviceMap.get(did);
      if (!info) continue;

      if (!perDevice[did]) {
        perDevice[did] = {
          deviceId: did,
          deviceName: info.name,
          workstationId: info.workstationId,
          workstationName: workstationNameMap.get(info.workstationId) ?? "",
          totalRequests: 0,
          byAction: {},
        };
      }

      const n = Number(row.count);
      perDevice[did]!.totalRequests += n;
      perDevice[did]!.byAction[row.action] = n;
    }

    const requests = Object.values(perDevice);
    const totalRequests = requests.reduce((s, r) => s + r.totalRequests, 0);

    return NextResponse.json({
      windowDays: daysBack,
      since: since.toISOString(),
      totalRequests,
      requests,
    });
  } catch (error) {
    console.error("Device usage error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
