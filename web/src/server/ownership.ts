import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { blueprint } from "~/server/db/schemas/blueprint";
import { workstation } from "~/server/db/schemas/workstation";

/**
 * Who owns what — the tenancy rules, with no session and no `Request` anywhere.
 *
 * A browser cookie and an MCP device token must resolve to the same answer, so the rule
 * itself lives here and the two front ends (`blueprint-access.ts`, `automations/access.ts`)
 * are thin wrappers that only decide which HTTP status to return.
 *
 * Deliberately free of `~/lib/auth`: importing better-auth is what would make this module
 * unusable from anything but a route handler, and the whole point is that it is usable
 * everywhere.
 */

/** Why something is out of reach, so the caller can pick a status code or a message. */
export type OwnershipFailure = "forbidden" | "not_found";

export async function ownsWorkstation(userId: string, workstationId: string): Promise<boolean> {
  const found = (
    await db
      .select({ userId: workstation.userId })
      .from(workstation)
      .where(eq(workstation.id, workstationId))
      .limit(1)
  )[0];
  return found?.userId === userId;
}

/**
 * Scoping the automation lookup by workstation as well as by id is the part that matters:
 * without it, knowing an automation id would be enough to reach one under a workstation you
 * do not own.
 */
export async function ownsAutomation(
  userId: string,
  workstationId: string,
  automationId: string,
): Promise<typeof automation.$inferSelect | OwnershipFailure> {
  // One round trip: the workstation, with the automation left-joined onto it. No row or
  // someone else's workstation is "forbidden"; our workstation without the automation is
  // "not_found", the same answers two sequential queries gave.
  const row = (
    await db
      .select({ owner: workstation.userId, found: automation })
      .from(workstation)
      .leftJoin(
        automation,
        and(eq(automation.workstationId, workstation.id), eq(automation.id, automationId)),
      )
      .where(eq(workstation.id, workstationId))
      .limit(1)
  )[0];
  if (row?.owner !== userId) return "forbidden";
  return row.found ?? "not_found";
}

/**
 * Device tokens narrow further via `hasGrant` — this answers *whose blueprint it is*, not
 * *which ones a device may touch*.
 */
export async function ownsBlueprint(
  userId: string,
  blueprintId: string,
): Promise<typeof blueprint.$inferSelect | OwnershipFailure> {
  // One round trip: the blueprint with its workstation's owner joined on.
  const row = (
    await db
      .select({ found: blueprint, owner: workstation.userId })
      .from(blueprint)
      .leftJoin(workstation, eq(workstation.id, blueprint.workstationId))
      .where(eq(blueprint.id, blueprintId))
      .limit(1)
  )[0];
  if (!row) return "not_found";

  return row.owner === userId ? row.found : "forbidden";
}
