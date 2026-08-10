import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { approval } from "~/server/db/schemas/approval";
import { device } from "~/server/db/schemas/device";

const bodySchema = z.object({
  /**
   * No `always`: that answer seeds the gate's grant cache and, with `persistGrants`,
   * rewrites the project's `.jarvis/jarvis.jsonc`. A tap on a phone should approve one
   * action, not widen policy on disk.
   */
  answer: z.enum(["once", "reject"]),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const row = (
    await db
      .select({ id: approval.id, answer: approval.answer, ownerId: device.userId })
      .from(approval)
      .innerJoin(device, eq(device.id, approval.deviceId))
      .where(eq(approval.id, id))
      .limit(1)
  )[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // `isNull(answer)` is the whole race: the terminal's cancel and a second tap both lose
  // here, so no lock and no transaction are needed to keep exactly one answer.
  const updated = await db
    .update(approval)
    .set({ answer: body.answer, answeredBy: session.user.id, answeredAt: new Date() })
    .where(and(eq(approval.id, id), isNull(approval.answer), gt(approval.expiresAt, new Date())))
    .returning({ answer: approval.answer });

  if (updated.length === 0) {
    const current = (await db.select({ answer: approval.answer }).from(approval).where(eq(approval.id, id)).limit(1))[0];
    return NextResponse.json(
      { error: "already_answered", answer: current?.answer ?? null },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true, answer: updated[0]?.answer });
}
