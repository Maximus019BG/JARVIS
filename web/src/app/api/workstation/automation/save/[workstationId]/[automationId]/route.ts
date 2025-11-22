import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { automation } from "~/server/db/schemas/automation";
import { workstation } from "~/server/db/schemas/workstation";
import { eq, and } from "drizzle-orm";
import { decodeId, getEncryptionSecret } from "~/lib/crypto-utils";
import { auth } from "~/lib/auth";
import { z } from "zod";

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
  if (existing.length > 0) {
    await db
      .update(automation)
      .set({
        name: data.name,
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
    await db
      .insert(automation)
      .values({
        id: decodedAutomationId,
        name: data.name,
        createdAt: new Date(),
        createdBy: workstationRecord.userId,
        metadata: data.data ? JSON.stringify(data.data) : null,
        workstationId: decodedWorkstationId,
        updatedAt: new Date(),
      });
  }

  return NextResponse.json({ success: true });
}
