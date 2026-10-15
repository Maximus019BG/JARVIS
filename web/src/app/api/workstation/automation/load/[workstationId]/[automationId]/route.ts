import { NextResponse } from "next/server";
import { authorizeAutomation } from "~/server/automations/access";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;
  const authorized = await authorizeAutomation(request, workstationId, automationId);
  if (authorized instanceof NextResponse) return authorized;
  const record = authorized.automation;

  // For milestone 1: keep response backward compatible but add versioning info.
  return NextResponse.json({
    ...record,
    versioning: {
      status: record.status,
      publishedVersion: record.publishedVersion,
    },
  });
}
