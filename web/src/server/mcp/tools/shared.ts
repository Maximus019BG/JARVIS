import type { automation } from "~/server/db/schemas/automation";
import type { blueprint } from "~/server/db/schemas/blueprint";
import { hasGrant } from "~/server/device-auth";
import { ownsAutomation, ownsBlueprint } from "~/server/ownership";
import { toolError } from "~/server/mcp/result";
import type { McpContext } from "~/server/mcp/types";

/**
 * The tenancy checks, phrased as throws so a tool body reads as if they had passed.
 *
 * Both collapse "not yours" and "does not exist" into one message. That is deliberate: a
 * distinguishable 403 would confirm to a caller that an id it guessed is real.
 */

export async function requireAutomation(
  ctx: McpContext,
  automationId: string,
): Promise<typeof automation.$inferSelect> {
  const found = await ownsAutomation(ctx.userId, ctx.workstationId, automationId);
  if (found === "forbidden" || found === "not_found") {
    toolError(`No automation ${automationId} on this workstation.`);
  }
  return found;
}

/**
 * Two gates, not one. `blueprints:write` says this token may write blueprints at all;
 * `hasGrant` says which ones — a token can hold the scope and still be limited to three
 * drawings. Read access needs a grant too: `readableBlueprintIds` is what the list is
 * filtered by, and a direct fetch must not be a way around it.
 */
export async function requireBlueprintAccess(
  ctx: McpContext,
  blueprintId: string,
  need: "read" | "write",
): Promise<typeof blueprint.$inferSelect> {
  const found = await ownsBlueprint(ctx.userId, blueprintId);
  if (found === "forbidden" || found === "not_found") {
    toolError(`No blueprint ${blueprintId} on this workstation.`);
  }
  if (found.workstationId !== ctx.workstationId) {
    toolError(`No blueprint ${blueprintId} on this workstation.`);
  }
  if (!(await hasGrant(ctx.deviceId, blueprintId, need))) {
    toolError(
      `This token has no ${need} grant for blueprint ${blueprintId}. Grant it in the device access settings.`,
    );
  }
  return found;
}
