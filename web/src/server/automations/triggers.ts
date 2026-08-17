import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { isTimeZone, parseCron } from "~/lib/automations/cron";
import { db } from "~/server/db";
import { automationTrigger } from "~/server/db/schemas/automation-trigger";

export const cronConfigSchema = z.object({
  expression: z.string().trim().min(1).max(200),
  /** IANA zone. A cron with no zone is a cron that fires at the wrong time twice a year. */
  tz: z.string().trim().min(1).max(64),
});

export const triggerInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook") }),
  z.object({ type: z.literal("cron"), config: cronConfigSchema }),
]);

export type TriggerInput = z.infer<typeof triggerInputSchema>;

export type CreateTriggerResult =
  | { ok: true; trigger: typeof automationTrigger.$inferSelect }
  | { ok: false; error: "invalid_cron" | "invalid_timezone"; detail: string };

/**
 * Creates a trigger after validating it.
 *
 * Validation happens here rather than at sweep time on purpose: a bad expression that is
 * only noticed by the scheduler is a trigger that silently never fires, and nobody goes
 * looking for a run that never happened. Shared with the MCP server so an agent cannot
 * write a trigger the browser would have rejected.
 *
 * The caller has already proved the user owns the automation.
 */
export async function createTrigger(
  automationId: string,
  workstationId: string,
  input: TriggerInput,
): Promise<CreateTriggerResult> {
  if (input.type === "cron") {
    if (!parseCron(input.config.expression)) {
      return {
        ok: false,
        error: "invalid_cron",
        detail: "Expected five fields: minute hour day-of-month month day-of-week.",
      };
    }
    if (!isTimeZone(input.config.tz)) {
      return { ok: false, error: "invalid_timezone", detail: `Not an IANA time zone: ${input.config.tz}` };
    }
  }

  const id = `atr_${nanoid(16)}`;
  await db.insert(automationTrigger).values({
    id,
    automationId,
    workstationId,
    type: input.type,
    // The webhook URL's only secret-ish component. Cron never uses it, but the column is
    // `notNull` and an unused id costs nothing.
    key: nanoid(24),
    config: input.type === "cron" ? input.config : null,
    createdAt: new Date(),
  });

  const created = (
    await db.select().from(automationTrigger).where(eq(automationTrigger.id, id)).limit(1)
  )[0]!;
  return { ok: true, trigger: created };
}
