import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { device } from "~/server/db/schemas/device";
import { isMcpScope } from "~/server/mcp/scopes";
import { ownsWorkstation } from "~/server/ownership";

/**
 * Replaces a device's MCP scopes. Replace rather than merge, for the same reason as the
 * sibling `grants` route: "these are the things this token may do" is the question the UI
 * asks, and a merge would make unticking a box do nothing.
 */

const bodySchema = z.object({
  scopes: z.array(z.string()).max(64).refine((all) => all.every(isMcpScope), {
    message: "unknown scope",
  }),
});

async function ownedDevice(request: Request, deviceId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = (await db.select().from(device).where(eq(device.id, deviceId)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await ownsWorkstation(session.user.id, target.workstationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return target;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;

  const target = await ownedDevice(request, deviceId);
  if (target instanceof NextResponse) return target;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const scopes = [...new Set(body.scopes)];
  await db.update(device).set({ scopes }).where(eq(device.id, deviceId));

  return NextResponse.json({ success: true, scopes });
}

/** What this token may do right now. */
export async function GET(request: Request, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;

  const target = await ownedDevice(request, deviceId);
  if (target instanceof NextResponse) return target;

  return NextResponse.json({ success: true, scopes: target.scopes });
}
