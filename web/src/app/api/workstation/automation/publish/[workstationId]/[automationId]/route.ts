import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "~/lib/auth";
import { decodeId, encodeId, getEncryptionSecret } from "~/lib/crypto-utils";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationVersion } from "~/server/db/schemas/automation-version";
import { workstation } from "~/server/db/schemas/workstation";

const publishSchema = z.object({
  // For milestone 1, we publish whatever the latest draft graph is.
  // In later milestones, this can include validation result, definition, compiledPlan, etc.
  definition: z.any().optional(),
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

  let secret: string;
  try {
    secret = getEncryptionSecret();
  } catch {
    return NextResponse.json({ error: "Server config" }, { status: 500 });
  }

  const decodedWorkstationId = decodeId(workstationId, secret);
  const decodedAutomationId = decodeId(automationId, secret);

  const workstationRecord = (
    await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, decodedWorkstationId))
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
          eq(automation.id, decodedAutomationId),
          eq(automation.workstationId, decodedWorkstationId),
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
      .where(eq(automationVersion.automationId, decodedAutomationId))
      .orderBy(desc(automationVersion.version))
      .limit(1)
  )[0];

  let versionToPublish = latestVersion?.version;

  if (!latestVersion) {
    const legacyGraph = automationRecord.metadata
      ? JSON.parse(automationRecord.metadata)
      : { nodes: [], edges: [] };

    // Create version 1
    await db.insert(automationVersion).values({
      id: crypto.randomUUID(),
      automationId: decodedAutomationId,
      version: 1,
      editorGraph: legacyGraph,
      definition: body.definition ?? null,
      compiledPlan: body.compiledPlan ?? null,
      createdBy: session.user.id,
      createdAt: new Date(),
    });

    versionToPublish = 1;
  }

  if (versionToPublish == null)
    return NextResponse.json({ error: "No version to publish" }, { status: 400 });

  await db
    .update(automation)
    .set({
      status: "active",
      publishedVersion: versionToPublish,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(automation.id, decodedAutomationId),
        eq(automation.workstationId, decodedWorkstationId),
      ),
    );

  return NextResponse.json({
    success: true,
    publishedVersion: versionToPublish,
    publishedVersionId: encodeId(String(versionToPublish), secret),
  });
}
