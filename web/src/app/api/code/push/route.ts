import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/server/db";
import { codeProject, codeVersion } from "~/server/db/schemas/code_project";
import { idempotencyKey } from "~/server/db/schemas/idempotency_key";
import { syncLog } from "~/server/db/schemas/sync_log";
import { authenticateDevice, forbidden } from "~/server/device-auth";
import { satisfies } from "~/server/mcp/scopes";

/** Base64 bundle plus a text snapshot. Anything bigger belongs on a git remote such as GitHub. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const PUSH_LIMIT_PER_MINUTE = 60;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const sha = z.string().regex(/^[0-9a-f]{40,64}$/);

const bodySchema = z.object({
  projectId: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  /** The head this push builds on — must equal ours, or the client has to pull first. */
  baseSha: sha.nullable(),
  headSha: sha,
  message: z.string().max(500).default(""),
  bundle: z.string().min(1),
  files: z.record(z.string().max(1024), z.string()).default({}),
});

const diverged = (serverHead: string | null, serverVersion: number) =>
  NextResponse.json(
    { error: "diverged", serverHead, serverVersion },
    { status: 409 },
  );

export async function POST(request: Request) {
  const authed = await authenticateDevice(request);
  if (authed instanceof NextResponse) return authed;
  const { device } = authed;
  // Pairing was consent to sync blueprints; source code needs its own yes.
  if (!satisfies(device.scopes, "code:write"))
    return forbidden("this device may not push code");

  const declared = Number(request.headers.get("content-length") ?? 0);
  const raw = declared > MAX_BODY_BYTES ? "" : await request.text();
  if (declared > MAX_BODY_BYTES || raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "payload_too_large", limit: MAX_BODY_BYTES },
      { status: 413 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(raw));
  } catch (error) {
    return NextResponse.json(
      {
        error: "invalid_request",
        detail:
          error instanceof z.ZodError
            ? error.issues.slice(0, 5)
            : String(error),
      },
      { status: 400 },
    );
  }

  const idempotency = request.headers.get("idempotency-key");
  if (idempotency) {
    const seen = (
      await db
        .select()
        .from(idempotencyKey)
        .where(eq(idempotencyKey.key, idempotency))
        .limit(1)
    )[0];
    if (seen && seen.expiresAt.getTime() > Date.now()) {
      return NextResponse.json(JSON.parse(seen.response) as unknown, {
        status: 200,
      });
    }
  }

  const minuteAgo = new Date(Date.now() - 60_000);
  const recent = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(syncLog)
    .where(
      and(eq(syncLog.deviceId, device.id), gt(syncLog.createdAt, minuteAgo)),
    );
  if ((recent[0]?.n ?? 0) >= PUSH_LIMIT_PER_MINUTE) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: 60 },
      { status: 429 },
    );
  }

  const existing = (
    await db
      .select()
      .from(codeProject)
      .where(eq(codeProject.id, body.projectId))
      .limit(1)
  )[0];
  if (existing && existing.workstationId !== device.workstationId) {
    return forbidden("project belongs to another workstation");
  }
  if (existing?.headSha === body.headSha) {
    return NextResponse.json({
      success: true,
      version: existing.version,
      head: existing.headSha,
      upToDate: true,
    });
  }
  if ((existing?.headSha ?? null) !== body.baseSha)
    return diverged(existing?.headSha ?? null, existing?.version ?? 0);

  const now = new Date();
  const version = (existing?.version ?? 0) + 1;
  const files = JSON.stringify(body.files);

  // The head check above is repeated inside the write — as the insert's conflict or the
  // update's WHERE — so two devices pushing at once cannot both win.
  const won = await db.transaction(async (tx) => {
    const moved = existing
      ? await tx
          .update(codeProject)
          .set({
            name: body.name,
            headSha: body.headSha,
            version,
            files,
            deviceId: device.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(codeProject.id, body.projectId),
              eq(codeProject.headSha, body.baseSha ?? ""),
            ),
          )
          .returning({ id: codeProject.id })
      : await tx
          .insert(codeProject)
          .values({
            id: body.projectId,
            name: body.name,
            workstationId: device.workstationId,
            createdBy: device.userId,
            deviceId: device.id,
            headSha: body.headSha,
            version,
            files,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: codeProject.id });
    if (moved.length === 0) return false;

    await tx.insert(codeVersion).values({
      id: `cdv_${nanoid(16)}`,
      projectId: body.projectId,
      version,
      commitSha: body.headSha,
      baseSha: body.baseSha,
      message: body.message,
      bundle: body.bundle,
      deviceId: device.id,
      createdAt: now,
    });
    await tx.insert(syncLog).values({
      id: `syn_${nanoid(16)}`,
      deviceId: device.id,
      action: "code_push",
      direction: "up",
      status: "ok",
      versionBefore: version - 1,
      versionAfter: version,
      createdAt: now,
    });
    return true;
  });
  if (!won) return diverged(null, existing?.version ?? 0);

  const response = { success: true, version, head: body.headSha };
  if (idempotency) {
    await db
      .insert(idempotencyKey)
      .values({
        key: idempotency,
        deviceId: device.id,
        response: JSON.stringify(response),
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        createdAt: now,
      })
      .onConflictDoNothing();
  }
  return NextResponse.json(response);
}
