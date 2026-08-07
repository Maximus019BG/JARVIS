import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { editorGraphToDefinition } from "~/lib/automations/definition";
import { automation } from "~/server/db/schemas/automation";
import { automationVersion } from "~/server/db/schemas/automation-version";
import { workstation } from "~/server/db/schemas/workstation";

const publishSchema = z.object({
  // Publish always derives/stores normalized definition from latest editor graph.
  compiledPlan: z.any().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });


  const workstationRecord = (
    await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, workstationId))
      .limit(1)
  )[0];
  if (!workstationRecord || workstationRecord.userId !== session.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = publishSchema.parse(await request.json().catch(() => ({})));

  // Ensure automation exists
  const automationRecord = (
    await db
      .select()
      .from(automation)
      .where(
        and(
          eq(automation.id, automationId),
          eq(automation.workstationId, workstationId),
        ),
      )
      .limit(1)
  )[0];
  if (!automationRecord)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Find latest version record; if none exists, bootstrap from legacy `metadata`
  const latestVersion = (
    await db
      .select()
      .from(automationVersion)
      .where(eq(automationVersion.automationId, automationId))
      .orderBy(desc(automationVersion.version))
      .limit(1)
  )[0];

  let versionToPublish = latestVersion?.version;

  if (!latestVersion) {
    const legacyGraph = automationRecord.metadata
      ? JSON.parse(automationRecord.metadata)
      : { nodes: [], edges: [] };

    const legacyDefinitionResult = editorGraphToDefinition(legacyGraph);
    if (legacyDefinitionResult.errors.length) {
      return NextResponse.json(
        { error: "Invalid workflow", details: legacyDefinitionResult.errors },
        { status: 400 },
      );
    }

    // Create version 1
    await db.insert(automationVersion).values({
      id: crypto.randomUUID(),
      automationId: automationId,
      version: 1,
      editorGraph: legacyGraph,
      definition: legacyDefinitionResult.definition,
      compiledPlan: body.compiledPlan ?? null,
      createdBy: session.user.id,
      createdAt: new Date(),
    });

    versionToPublish = 1;
  }

  if (versionToPublish == null)
    return NextResponse.json({ error: "No version to publish" }, { status: 400 });

  // Update the existing latest version to include normalized definition for the published artifact.
  if (latestVersion) {
    const normalized = editorGraphToDefinition(latestVersion.editorGraph as any);
    if (normalized.errors.length) {
      return NextResponse.json(
        { error: "Invalid workflow", details: normalized.errors },
        { status: 400 },
      );
    }

    await db
      .update(automationVersion)
      .set({
        definition: normalized.definition,
        compiledPlan: body.compiledPlan ?? latestVersion.compiledPlan,
      })
      .where(eq(automationVersion.id, latestVersion.id));
  }

  await db
    .update(automation)
    .set({
      status: "active",
      publishedVersion: versionToPublish,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(automation.id, automationId),
        eq(automation.workstationId, workstationId),
      ),
    );

  return NextResponse.json({
    success: true,
    publishedVersion: versionToPublish,
  });
}
