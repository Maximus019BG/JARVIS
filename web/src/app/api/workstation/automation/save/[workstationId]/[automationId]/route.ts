import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "~/lib/auth";
import type { EditorGraph } from "~/server/automations/publish";
import { saveAutomationGraph } from "~/server/automations/save";
import { ownsWorkstation } from "~/server/ownership";

const automationSaveSchema = z.object({
  name: z.string().min(1),
  data: z.any().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ workstationId: string; automationId: string }> },
) {
  const { workstationId, automationId } = await ctx.params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Not `authorizeAutomation`: this route creates the automation as well as updating it, and
  // that helper 404s on one that does not exist yet.
  if (!(await ownsWorkstation(session.user.id, workstationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let data: z.infer<typeof automationSaveSchema>;
  try {
    data = automationSaveSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { version } = await saveAutomationGraph({
    automationId,
    workstationId,
    userId: session.user.id,
    name: data.name,
    graph: (data.data as EditorGraph | undefined) ?? null,
  });

  return NextResponse.json({ success: true, version });
}
