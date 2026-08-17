import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { workstation } from "~/server/db/schemas/workstation";
import type { McpModule } from "~/server/mcp/types";
import { tool } from "~/server/mcp/types";

export const workstationsModule: McpModule = {
  area: "workstations",
  tools: [
    tool({
      name: "whoami",
      title: "Who am I",
      description:
        "The workstation this token is bound to, and what it is allowed to do. Call this first: every other tool operates on this workstation and takes no workstation argument.",
      scope: "workstations:read",
      input: z.object({}),
      handler: async (_args, ctx) => {
        const found = (
          await db
            .select({ id: workstation.id, name: workstation.name })
            .from(workstation)
            .where(eq(workstation.id, ctx.workstationId))
            .limit(1)
        )[0];
        return {
          workstation: found ?? { id: ctx.workstationId, name: null },
          tokenName: ctx.device.name,
          scopes: ctx.scopes,
        };
      },
    }),

    tool({
      name: "device_list",
      title: "List devices",
      description:
        "Machines paired to this workstation, with when each was last seen. A workstation must be polling for automations with agent steps to make progress, so this is how you check whether a suspended run has anything to pick it up.",
      scope: "devices:read",
      input: z.object({}),
      handler: async (_args, ctx) =>
        db
          .select({
            id: device.id,
            name: device.name,
            platform: device.platform,
            status: device.status,
            lastSeenAt: device.lastSeenAt,
          })
          .from(device)
          .where(eq(device.workstationId, ctx.workstationId)),
    }),
  ],
};
