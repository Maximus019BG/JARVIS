import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/server/db";
import { agentSession } from "~/server/db/schemas/agent_session";
import { syncLog } from "~/server/db/schemas/sync_log";
import { authenticateDevice, forbidden } from "~/server/device-auth";

/** Transcripts dwarf blueprints: a long agentic session is megabytes of tool output. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PUSH_LIMIT_PER_MINUTE = 60;

const bodySchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  cwd: z.string().max(1024),
  startedAt: z.coerce.date(),
  lines: z.number().int().min(1),
  transcript: z.string().max(MAX_BODY_BYTES),
  turns: z.number().int().min(0).default(0),
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  costMicros: z.number().int().min(0).default(0),
});

export async function POST(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  const { device } = authed;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large", limit: MAX_BODY_BYTES }, { status: 413 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large", limit: MAX_BODY_BYTES }, { status: 413 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(raw));
  } catch (error) {
    return NextResponse.json(
      { error: "invalid_request", detail: error instanceof z.ZodError ? error.issues.slice(0, 5) : String(error) },
      { status: 400 },
    );
  }

  const minuteAgo = new Date(Date.now() - 60_000);
  const recent = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(syncLog)
    .where(and(eq(syncLog.deviceId, device.id), gt(syncLog.createdAt, minuteAgo)));
  if ((recent[0]?.n ?? 0) >= PUSH_LIMIT_PER_MINUTE) {
    return NextResponse.json({ error: "rate_limited", retryAfter: 60 }, { status: 429 });
  }

  const existing = (
    await db.select().from(agentSession).where(eq(agentSession.id, body.id)).limit(1)
  )[0];
  if (existing && existing.workstationId !== device.workstationId) {
    return forbidden("that session belongs to another workstation");
  }
  // Nothing new on this side. Not an error: the client sweeps every session on startup and
  // most of them will not have moved.
  if (existing && body.lines <= existing.lines) {
    return NextResponse.json({ success: true, upToDate: true, lines: existing.lines });
  }

  const now = new Date();
  // No idempotency key: a full-state upsert keyed on the session's own id is idempotent by
  // construction, and there is no partial application to replay. No grant check either —
  // device grants scope blueprints, and a session is not one.
  await db
    .insert(agentSession)
    .values({
      id: body.id,
      workstationId: device.workstationId,
      deviceId: device.id,
      createdBy: device.userId,
      title: body.title,
      cwd: body.cwd,
      startedAt: body.startedAt,
      updatedAt: now,
      lines: body.lines,
      transcript: body.transcript,
      turns: body.turns,
      inputTokens: body.inputTokens,
      outputTokens: body.outputTokens,
      costMicros: body.costMicros,
    })
    .onConflictDoUpdate({
      target: agentSession.id,
      set: {
        title: body.title,
        updatedAt: now,
        lines: body.lines,
        transcript: body.transcript,
        turns: body.turns,
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
        costMicros: body.costMicros,
        deviceId: device.id,
      },
    });

  await db.insert(syncLog).values({
    id: `syn_${nanoid(16)}`,
    // Nullable, and this is not a blueprint push.
    blueprintId: null,
    deviceId: device.id,
    action: "session-push",
    direction: "up",
    status: "ok",
    versionBefore: existing?.lines ?? 0,
    versionAfter: body.lines,
    createdAt: now,
  });

  return NextResponse.json({ success: true, lines: body.lines });
}
