import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "~/lib/auth";
import { db } from "~/server/db";
import { agentSession } from "~/server/db/schemas/agent_session";
import { sessionPrompt } from "~/server/db/schemas/session_prompt";
import { workstation } from "~/server/db/schemas/workstation";

/** Long enough for a paragraph of direction, short enough not to be a file upload. */
const MAX_PROMPT = 8000;
/** Prompts already waiting before another is refused, so a stuck terminal cannot be flooded. */
const MAX_PENDING = 10;

const bodySchema = z.object({ prompt: z.string().trim().min(1).max(MAX_PROMPT) });

/**
 * Queues a prompt for the terminal running this session to pick up.
 *
 * This is remote input to a machine whose agent can run `bash` and edit files, so the
 * authorization here is the whole point: only the session's owner may write, and the TUI
 * refuses to poll at all unless it was configured to. Whatever lands still goes through the
 * terminal's normal permission gate — queueing a prompt is not an approval.
 */
export async function POST(request: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const row = (
    await db
      .select({ id: agentSession.id, ownerId: workstation.userId })
      .from(agentSession)
      .innerJoin(workstation, eq(workstation.id, agentSession.workstationId))
      .where(eq(agentSession.id, sessionId))
      .limit(1)
  )[0];

  // 404 rather than 403 for somebody else's session, matching the session viewer: whether an
  // id exists is itself information, and the owner is the only one who needs to tell apart.
  if (row?.ownerId !== session.user.id) notFound();

  const pending = await db
    .select({ id: sessionPrompt.id })
    .from(sessionPrompt)
    .where(and(eq(sessionPrompt.sessionId, sessionId), eq(sessionPrompt.status, "pending")))
    .limit(MAX_PENDING);
  if (pending.length >= MAX_PENDING) {
    return NextResponse.json(
      { error: "too_many_pending", detail: "The workstation has not picked up the earlier prompts yet." },
      { status: 429 },
    );
  }

  const id = `spr_${nanoid(16)}`;
  await db.insert(sessionPrompt).values({
    id,
    sessionId,
    prompt: body.prompt,
    createdBy: session.user.id,
  });

  return NextResponse.json({ id, status: "pending" });
}

/** What is still waiting, so the form can say "queued" rather than pretend it was delivered. */
export async function GET(request: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: sessionPrompt.id,
      prompt: sessionPrompt.prompt,
      status: sessionPrompt.status,
      createdAt: sessionPrompt.createdAt,
      deliveredAt: sessionPrompt.deliveredAt,
    })
    .from(sessionPrompt)
    .innerJoin(agentSession, eq(agentSession.id, sessionPrompt.sessionId))
    .innerJoin(workstation, eq(workstation.id, agentSession.workstationId))
    .where(and(eq(sessionPrompt.sessionId, sessionId), eq(workstation.userId, session.user.id)))
    .orderBy(desc(sessionPrompt.createdAt))
    .limit(20);

  return NextResponse.json({ prompts: rows });
}
