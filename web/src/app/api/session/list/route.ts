import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentSession } from "~/server/db/schemas/agent_session";
import { authenticateDevice } from "~/server/device-auth";

/**
 * The sync cursor: what the server already has, and how far. The client diffs against it
 * so it needs no local sync state of its own — nothing to get out of step after a crash,
 * a restore, or a session file edited by hand.
 */
export async function GET(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;

  const rows = await db
    .select({ id: agentSession.id, lines: agentSession.lines })
    .from(agentSession)
    .where(eq(agentSession.workstationId, authed.device.workstationId));

  return NextResponse.json({ sessions: rows });
}
