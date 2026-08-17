import { and, desc, eq } from "drizzle-orm";
import type { Edge, Node } from "reactflow";

import { editorGraphToDefinition } from "~/lib/automations/definition";
import type { EditorNodeData } from "~/components/automations/node-config-panel";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationVersion } from "~/server/db/schemas/automation-version";

/** The editor graph as it comes back out of `jsonb`: shape unverified until it compiles. */
export type EditorGraph = { nodes: Node<EditorNodeData>[]; edges: Edge[] };

const EMPTY_GRAPH: EditorGraph = { nodes: [], edges: [] };

export type PublishResult =
  | { ok: true; publishedVersion: number }
  | { ok: false; errors: string[] };

/**
 * Compile the latest saved version and mark it published.
 *
 * Lives here rather than in the route because the MCP server publishes too, and a second
 * copy of "which version counts, and what does compiling it mean" is exactly the kind of
 * drift that makes a webhook fire the wrong graph. The caller has already proved ownership.
 *
 * Bootstraps a version 1 from the legacy `automation.metadata` column when no
 * `automation_version` row exists yet — old automations predate the versions table.
 */
export async function publishAutomation(
  automationRecord: typeof automation.$inferSelect,
  userId: string,
  compiledPlan: unknown = null,
): Promise<PublishResult> {
  const automationId = automationRecord.id;

  const latestVersion = (
    await db
      .select()
      .from(automationVersion)
      .where(eq(automationVersion.automationId, automationId))
      .orderBy(desc(automationVersion.version))
      .limit(1)
  )[0];

  let versionToPublish: number;

  if (latestVersion) {
    const normalized = editorGraphToDefinition((latestVersion.editorGraph as EditorGraph | null) ?? EMPTY_GRAPH);
    if (normalized.errors.length) return { ok: false, errors: normalized.errors };

    await db
      .update(automationVersion)
      .set({
        definition: normalized.definition,
        compiledPlan: compiledPlan ?? latestVersion.compiledPlan,
      })
      .where(eq(automationVersion.id, latestVersion.id));

    versionToPublish = latestVersion.version;
  } else {
    let legacyGraph: EditorGraph = EMPTY_GRAPH;
    if (automationRecord.metadata) {
      try {
        legacyGraph = JSON.parse(automationRecord.metadata) as EditorGraph;
      } catch {
        // A metadata blob that no longer parses must not publish as an empty graph — that
        // would report success having compiled nothing at all.
        return { ok: false, errors: ["The saved graph could not be read. Open the editor and save again."] };
      }
    }

    const compiled = editorGraphToDefinition(legacyGraph);
    if (compiled.errors.length) return { ok: false, errors: compiled.errors };

    await db.insert(automationVersion).values({
      id: crypto.randomUUID(),
      automationId,
      version: 1,
      editorGraph: legacyGraph,
      definition: compiled.definition,
      compiledPlan: compiledPlan ?? null,
      createdBy: userId,
      createdAt: new Date(),
    });

    versionToPublish = 1;
  }

  await db
    .update(automation)
    .set({ status: "active", publishedVersion: versionToPublish, updatedAt: new Date() })
    .where(
      and(eq(automation.id, automationId), eq(automation.workstationId, automationRecord.workstationId)),
    );

  return { ok: true, publishedVersion: versionToPublish };
}
