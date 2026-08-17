import { and, desc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationVersion } from "~/server/db/schemas/automation-version";
import type { EditorGraph } from "~/server/automations/publish";

/**
 * Upserts the automation and appends a draft version holding the editor graph.
 *
 * A new `automation_version` row on every save is deliberate — it is what makes "published"
 * and "newest" different things, so opening the editor cannot change what a webhook runs.
 * See the note on `publishedVersionOf` in `runner.ts`.
 *
 * The caller has already proved the user owns `workstationId`.
 */
export async function saveAutomationGraph(args: {
  automationId: string;
  workstationId: string;
  userId: string;
  name: string;
  graph: EditorGraph | null;
}): Promise<{ version: number }> {
  const { automationId, workstationId, userId, name, graph } = args;
  const now = new Date();
  const scoped = and(eq(automation.id, automationId), eq(automation.workstationId, workstationId));

  const existing = await db.select({ id: automation.id }).from(automation).where(scoped).limit(1);

  if (existing.length > 0) {
    await db
      .update(automation)
      // Legacy `metadata` is kept in step because the edit page still reads it.
      .set({ name, metadata: graph ? JSON.stringify(graph) : null, updatedAt: now })
      .where(scoped);
  } else {
    await db.insert(automation).values({
      id: automationId,
      name,
      status: "draft",
      publishedVersion: null,
      createdAt: now,
      createdBy: userId,
      metadata: graph ? JSON.stringify(graph) : null,
      workstationId,
      updatedAt: now,
    });
  }

  const latest = (
    await db
      .select({ version: automationVersion.version })
      .from(automationVersion)
      .where(eq(automationVersion.automationId, automationId))
      .orderBy(desc(automationVersion.version))
      .limit(1)
  )[0];
  const version = (latest?.version ?? 0) + 1;

  await db.insert(automationVersion).values({
    id: crypto.randomUUID(),
    automationId,
    version,
    editorGraph: graph ?? { nodes: [], edges: [] },
    definition: null,
    compiledPlan: null,
    createdBy: userId,
    createdAt: now,
  });

  return { version };
}
