import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "~/server/db";
import { gatewayUsage } from "~/server/db/schemas/gateway_usage";
import type { GatewayFailure } from "./errors";
import type { ResolvedTarget } from "./resolve";
import { LIMITS } from "./upstreams";
import { costMicros, type TokenUsage } from "./usage";

/** Midnight on the first of the current month, UTC — the quota window. */
const monthStart = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

/**
 * Both limits in one query.
 *
 * One index scan and two aggregates rather than two round-trips, because this runs before the
 * first token of every request and latency here is latency the reader sees.
 *
 * Honest about what this is not: a read followed by a write, so N concurrent requests can each
 * pass the check at the boundary. Worst-case overshoot is roughly concurrency × max cost per
 * request — a few dollars for a single-owner deployment, which is a trade worth taking over
 * introducing Redis or a serialised counter row for this alone.
 */
export async function checkLimits(userId: string, deviceId: string): Promise<GatewayFailure | undefined> {
  const minuteAgo = new Date(Date.now() - 60_000);
  const rows = await db
    .select({
      recent: sql<number>`count(*) filter (where ${gatewayUsage.deviceId} = ${deviceId} and ${gatewayUsage.createdAt} > ${minuteAgo})::int`,
      spend: sql<number>`coalesce(sum(${gatewayUsage.costMicros}), 0)::bigint`,
    })
    .from(gatewayUsage)
    .where(and(eq(gatewayUsage.userId, userId), gte(gatewayUsage.createdAt, monthStart())));

  const gate = rows[0];
  if ((gate?.recent ?? 0) >= LIMITS.rpmPerDevice) {
    return { status: 429, code: "rate_limited", message: "too many requests from this device", retryAfter: 60 };
  }
  if (Number(gate?.spend ?? 0) >= LIMITS.monthlyCostMicrosPerUser) {
    const next = new Date(monthStart());
    next.setUTCMonth(next.getUTCMonth() + 1);
    return {
      status: 429,
      code: "quota_exceeded",
      message: "this month's gateway budget is spent",
      retryAfter: Math.max(60, Math.ceil((next.getTime() - Date.now()) / 1000)),
    };
  }
  return undefined;
}

/** Reserves the row that is both the bill and the counter. Returns its id. */
export async function reserveUsage(args: {
  userId: string;
  deviceId: string;
  workstationId: string;
  requestedModel: string;
  streamed: boolean;
}): Promise<string> {
  const id = `gwu_${nanoid(16)}`;
  await db.insert(gatewayUsage).values({
    id,
    userId: args.userId,
    deviceId: args.deviceId,
    workstationId: args.workstationId,
    requestedModel: args.requestedModel,
    status: "pending",
    streamed: args.streamed,
  });
  return id;
}

/** Settles a reserved row. Best effort: never let bookkeeping fail a served request. */
export async function settleUsage(
  id: string,
  fields: {
    status: string;
    target?: ResolvedTarget;
    usage?: TokenUsage | null;
    upstreamStatus?: number;
    latencyMs?: number;
    attempts?: number;
  },
): Promise<void> {
  const usage = fields.usage ?? null;
  try {
    await db
      .update(gatewayUsage)
      .set({
        status: fields.status,
        ...(fields.target
          ? { upstreamName: fields.target.upstream.name, upstreamModel: fields.target.model }
          : {}),
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        costMicros: usage ? costMicros(usage, fields.target?.upstream.cost) : 0,
        // No usage block, or an upstream with no price list, means the number is not a real bill.
        // The usage page can say so rather than quietly overstating or understating it.
        estimated: !usage || !fields.target?.upstream.cost,
        ...(fields.upstreamStatus !== undefined ? { upstreamStatus: fields.upstreamStatus } : {}),
        ...(fields.latencyMs !== undefined ? { latencyMs: fields.latencyMs } : {}),
        ...(fields.attempts !== undefined ? { attempts: fields.attempts } : {}),
      })
      .where(eq(gatewayUsage.id, id));
  } catch {
    // A failed settle must not truncate a completion the reader has already seen.
  }
}
