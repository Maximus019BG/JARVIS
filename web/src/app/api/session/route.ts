import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { agentSession } from "~/server/db/schemas/agent_session";
import { sessionPrompt } from "~/server/db/schemas/session_prompt";
import { workstation } from "~/server/db/schemas/workstation";
import { steerable } from "~/server/steering";

/**
 * The signed-in user's sessions, for a client that wants to steer one.
 *
 * Not to be confused with `/api/session/list`, which is device-authenticated and exists so a
 * paired terminal can work out what it still has to upload. This one answers a different
 * question for a different caller: *which of my terminals could I talk to right now*, which
 * is what a phone needs before it offers a microphone.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: agentSession.id,
      title: agentSession.title,
      cwd: agentSession.cwd,
      workstation: workstation.name,
      updatedAt: agentSession.updatedAt,
      // Counted in SQL rather than fetched and length-checked: the only thing anybody wants
      // from the pending rows is how many there are.
      queued: sql<number>`(
        select count(*)::int from ${sessionPrompt}
        where ${sessionPrompt.sessionId} = ${agentSession.id} and ${sessionPrompt.status} = 'pending'
      )`,
    })
    .from(agentSession)
    .innerJoin(workstation, eq(workstation.id, agentSession.workstationId))
    .where(and(eq(workstation.userId, session.user.id)));

  return NextResponse.json({ sessions: steerable(rows, Date.now()) });
}
