import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "~/lib/auth";
import { decodeId, getEncryptionSecret } from "~/lib/crypto-utils";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { automationVersion } from "~/server/db/schemas/automation-version";
import { workstation } from "~/server/db/schemas/workstation";

const automationSaveSchema = z.object({
  name: z.string().min(1),
  data: z.any().optional(),
});

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;
  const session = await auth.api.getSession({ headers: _request.headers });
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!workstationId)
    return NextResponse.json(
      { error: "Workstation not found" },
      { status: 404 },
    );
  if (!automationId)
    return NextResponse.json(
      { error: "Automation not found" },
      { status: 404 },
    );

  let secret: string;
  try {
    secret = getEncryptionSecret();
  } catch (error) {
    return NextResponse.json({ error: "Server config" }, { status: 500 });
  }

  const decodedWorkstationId = decodeId(workstationId, secret);
  const decodedAutomationId = decodeId(automationId, secret);

  const data = automationSaveSchema.parse(await _request.json());

  const workstationRecord = (
    await db
      .select()
      .from(workstation)
      .where(eq(workstation.id, decodedWorkstationId))
      .limit(1)
  )[0];
  if (!workstationRecord || workstationRecord.userId !== session.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await db
    .select()
    .from(automation)
    .where(
      and(
        eq(automation.id, decodedAutomationId),
        eq(automation.workstationId, decodedWorkstationId),
      ),
    )
    .limit(1);
  // Upsert automation record
  if (existing.length > 0) {
    await db
      .update(automation)
      .set({
        name: data.name,
        // keep legacy metadata for backward compatibility (edit page still reads it)
        metadata: data.data ? JSON.stringify(data.data) : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(automation.id, decodedAutomationId),
          eq(automation.workstationId, decodedWorkstationId),
        ),
      );
  } else {
    await db.insert(automation).values({
      id: decodedAutomationId,
      name: data.name,
      status: "draft",
      publishedVersion: null,
      createdAt: new Date(),
      createdBy: workstationRecord.userId,
      metadata: data.data ? JSON.stringify(data.data) : null,
      workstationId: decodedWorkstationId,
      updatedAt: new Date(),
    });
  }

  // Create a new draft version snapshot on each save (simple + safe).
  // Later we can add optimistic concurrency or explicit “Save version” UX.
  const latest = (
    await db
      .select()
      .from(automationVersion)
      .where(eq(automationVersion.automationId, decodedAutomationId))
      .orderBy(desc(automationVersion.version))
      .limit(1)
  )[0];

  const nextVersion = (latest?.version ?? 0) + 1;

  await db.insert(automationVersion).values({
    id: crypto.randomUUID(),
    automationId: decodedAutomationId,
    version: nextVersion,
    editorGraph: data.data ?? { nodes: [], edges: [] },
    definition: null,
    compiledPlan: null,
    createdBy: session.user.id,
    createdAt: new Date(),
  });

  return NextResponse.json({ success: true });
}
