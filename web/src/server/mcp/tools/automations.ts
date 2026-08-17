import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationRun } from "~/server/db/schemas/automation-run";
import { automationRunStep } from "~/server/db/schemas/automation-run-step";
import { automationTrigger } from "~/server/db/schemas/automation-trigger";
import { automationVersion } from "~/server/db/schemas/automation-version";
import { publishedVersionOf, startRun } from "~/server/automations/runner";
import { createTrigger, triggerInputSchema } from "~/server/automations/triggers";
import { requireAutomation } from "~/server/mcp/tools/shared";
import { toolError } from "~/server/mcp/result";
import type { McpModule } from "~/server/mcp/types";
import { tool } from "~/server/mcp/types";

const automationId = z.string().min(1).describe("Automation id, from automation_list.");

export const automationsModule: McpModule = {
  area: "automations",
  tools: [
    tool({
      name: "automation_list",
      title: "List automations",
      description:
        "Every automation on this workstation, with its status and published version. `status: active` with a non-null `publishedVersion` is the only combination automation_run accepts.",
      scope: "automations:read",
      input: z.object({}),
      handler: async (_args, ctx) =>
        db
          .select({
            id: automation.id,
            name: automation.name,
            status: automation.status,
            publishedVersion: automation.publishedVersion,
            updatedAt: automation.updatedAt,
          })
          .from(automation)
          .where(eq(automation.workstationId, ctx.workstationId))
          .orderBy(desc(automation.updatedAt)),
    }),

    tool({
      name: "automation_get",
      title: "Get an automation",
      description:
        "One automation with its latest saved graph and, if published, the compiled definition the runner actually executes. The two differ whenever somebody has saved without publishing.",
      scope: "automations:read",
      input: z.object({ automationId }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);

        const latest = (
          await db
            .select()
            .from(automationVersion)
            .where(eq(automationVersion.automationId, found.id))
            .orderBy(desc(automationVersion.version))
            .limit(1)
        )[0];

        const published = await publishedVersionOf(found.id, found.publishedVersion);

        return {
          id: found.id,
          name: found.name,
          status: found.status,
          publishedVersion: found.publishedVersion,
          latestVersion: latest?.version ?? null,
          editorGraph: latest?.editorGraph ?? null,
          publishedDefinition: published?.definition ?? null,
        };
      },
    }),

    tool({
      name: "automation_versions",
      title: "List automation versions",
      description:
        "Saved versions, newest first. A version is written on every save, so the newest is not necessarily the published one.",
      scope: "automations:read",
      input: z.object({ automationId }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);
        return db
          .select({
            id: automationVersion.id,
            version: automationVersion.version,
            compiled: automationVersion.definition,
            createdAt: automationVersion.createdAt,
          })
          .from(automationVersion)
          .where(eq(automationVersion.automationId, found.id))
          .orderBy(desc(automationVersion.version));
      },
    }),

    tool({
      name: "automation_runs",
      title: "List runs",
      description: "Recent runs of one automation, newest first.",
      scope: "automations:read",
      input: z.object({
        automationId,
        limit: z.number().int().min(1).max(100).default(20),
      }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);
        return db
          .select({
            id: automationRun.id,
            status: automationRun.status,
            stepCount: automationRun.stepCount,
            startedAt: automationRun.startedAt,
            finishedAt: automationRun.finishedAt,
          })
          .from(automationRun)
          .where(eq(automationRun.automationId, found.id))
          .orderBy(desc(automationRun.createdAt))
          .limit(args.limit);
      },
    }),

    tool({
      name: "automation_run_get",
      title: "Get a run",
      description:
        "One run with every step's input, output and error. `suspended` means the run is waiting on a workstation to execute an agent step — poll this tool again rather than starting another run. Use device_list to check a workstation is actually online.",
      scope: "automations:read",
      input: z.object({ runId: z.string().min(1) }),
      handler: async (args, ctx) => {
        const run = (
          await db
            .select()
            .from(automationRun)
            .where(and(eq(automationRun.id, args.runId), eq(automationRun.workstationId, ctx.workstationId)))
            .limit(1)
        )[0];
        // Scoped by workstation, so a run id from somewhere else is indistinguishable from
        // one that does not exist.
        if (!run) toolError(`No run ${args.runId} on this workstation.`);

        const steps = await db
          .select()
          .from(automationRunStep)
          .where(eq(automationRunStep.runId, run.id))
          .orderBy(asc(automationRunStep.index));

        const waiting = steps.find((step) => step.status === "running" || step.status === "queued");

        return {
          id: run.id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          suspended: Boolean(waiting),
          waitingOn: waiting ? { index: waiting.index, type: waiting.type, name: waiting.name } : null,
          steps: steps.map((step) => ({
            index: step.index,
            type: step.type,
            name: step.name,
            status: step.status,
            output: step.output,
            error: step.error,
          })),
        };
      },
    }),

    tool({
      name: "automation_run",
      title: "Run an automation",
      description:
        "Starts the published version now and returns a runId. Does NOT wait for the result: an agent step hands work to a paired workstation and suspends the run, so call automation_run_get with the runId to see what happened.",
      scope: "automations:write",
      input: z.object({
        automationId,
        input: z
          .unknown()
          .optional()
          .describe("Trigger payload the graph reads as {{$json}}. Omit if the graph ignores it."),
      }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);

        if (found.status !== "active" || !found.publishedVersion) {
          toolError(`"${found.name}" is not published. Call automation_publish first.`);
        }

        const version = await publishedVersionOf(found.id, found.publishedVersion);
        if (!version) toolError("The published version is missing.");
        // Only publish writes `definition`, and the runner treats a missing one as an empty
        // graph — without this the run would report success having executed nothing.
        if (!version.definition) toolError("The published version was never compiled. Publish again.");

        return startRun({
          automationId: found.id,
          automationVersionId: version.id,
          workstationId: ctx.workstationId,
          triggerId: null,
          input: args.input ?? null,
        });
      },
    }),

    tool({
      name: "automation_set_status",
      title: "Pause or resume an automation",
      description:
        "Sets status to active, paused or archived. Only an active automation runs from a trigger or from automation_run. Activating requires a published version.",
      scope: "automations:write",
      input: z.object({
        automationId,
        status: z.enum(["active", "paused", "archived"]),
      }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);
        if (args.status === "active" && !found.publishedVersion) {
          toolError(`"${found.name}" has never been published, so there is nothing to activate.`);
        }

        await db
          .update(automation)
          .set({ status: args.status, updatedAt: new Date() })
          .where(eq(automation.id, found.id));

        return { id: found.id, status: args.status };
      },
    }),

    tool({
      name: "automation_triggers",
      title: "List triggers",
      description: "Webhook and cron triggers on one automation.",
      scope: "automations:read",
      input: z.object({ automationId }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);
        return db
          .select({
            id: automationTrigger.id,
            type: automationTrigger.type,
            key: automationTrigger.key,
            config: automationTrigger.config,
            lastFiredAt: automationTrigger.lastFiredAt,
          })
          .from(automationTrigger)
          .where(eq(automationTrigger.automationId, found.id))
          .orderBy(asc(automationTrigger.createdAt));
      },
    }),

    tool({
      name: "automation_trigger_create",
      title: "Create a trigger",
      description:
        "Adds a webhook or cron trigger. Cron expressions are five fields and the timezone must be an IANA name. Caveat worth stating to the user: cron only fires while a paired workstation is polling — a missed minute does not fire late, it does not fire at all.",
      scope: "automations:write",
      input: z.object({ automationId, trigger: triggerInputSchema }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);
        const result = await createTrigger(found.id, ctx.workstationId, args.trigger);
        if (!result.ok) toolError(result.detail);
        return result;
      },
    }),

    tool({
      name: "automation_trigger_delete",
      title: "Delete a trigger",
      description: "Removes a trigger. For a webhook this revokes the URL immediately.",
      scope: "automations:write",
      input: z.object({ automationId, triggerId: z.string().min(1) }),
      handler: async (args, ctx) => {
        const found = await requireAutomation(ctx, args.automationId);
        const deleted = await db
          .delete(automationTrigger)
          .where(
            and(eq(automationTrigger.id, args.triggerId), eq(automationTrigger.automationId, found.id)),
          )
          .returning({ id: automationTrigger.id });

        if (deleted.length === 0) toolError(`No trigger ${args.triggerId} on that automation.`);
        return { deleted: args.triggerId };
      },
    }),
  ],
};
