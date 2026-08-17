import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeAutomation } from "~/server/automations/access";
import { publishAutomation } from "~/server/automations/publish";

const publishSchema = z.object({
  // Publish always derives/stores normalized definition from latest editor graph.
  compiledPlan: z.any().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;

  const authed = await authorizeAutomation(request, workstationId, automationId);
  if (authed instanceof NextResponse) return authed;

  const body = publishSchema.parse(await request.json().catch(() => ({})));

  const result = await publishAutomation(authed.automation, authed.userId, body.compiledPlan ?? null);
  if (!result.ok) {
    return NextResponse.json({ error: "Invalid workflow", details: result.errors }, { status: 400 });
  }

  return NextResponse.json({ success: true, publishedVersion: result.publishedVersion });
}
