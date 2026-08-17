import { BlueprintDocSchema } from "@blueprint/schema.ts";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { idempotencyKey } from "~/server/db/schemas/idempotency_key";
import { syncLog } from "~/server/db/schemas/sync_log";
import { authenticateDevice, forbidden, hasGrant, sha256 } from "~/server/device-auth";

/** A blueprint is kilobytes of JSON. A megabyte-scale body is a mistake or an attack. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_COMMITS = 200;
const PUSH_LIMIT_PER_MINUTE = 60;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const commitSchema = z.object({
  sha: z.string().min(4).max(64),
  parentSha: z.string().min(4).max(64).nullable(),
  message: z.string().max(500).default(""),
  at: z.coerce.date().optional(),
  /** Validated as a real document, not stored as an opaque blob. */
  doc: BlueprintDocSchema,
});

const bodySchema = z.object({
  /** Stable id from the blueprint file itself, so a rename does not fork history. */
  blueprintId: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  commits: z.array(commitSchema).min(1).max(MAX_COMMITS),
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

  // Replay of a retried push returns the original answer rather than doing the work
  // twice. The client sends the same key when it retries a request whose reply it lost.
  const idempotency = request.headers.get("idempotency-key");
  if (idempotency) {
    const seen = (
      await db.select().from(idempotencyKey).where(eq(idempotencyKey.key, idempotency)).limit(1)
    )[0];
    if (seen && seen.expiresAt.getTime() > Date.now()) {
      return NextResponse.json(JSON.parse(seen.response) as unknown, { status: 200 });
    }
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
    await db.select().from(blueprint).where(eq(blueprint.id, body.blueprintId)).limit(1)
  )[0];

  // A blueprint the server has never seen is created here, but only inside the device's
  // own workstation, and only if the device may write at all.
  if (existing && existing.workstationId !== device.workstationId) {
    return forbidden("blueprint belongs to another workstation");
  }
  if (!(await hasGrant(device.id, body.blueprintId, "write"))) {
    await db.insert(syncLog).values({
      id: `syn_${nanoid(16)}`,
      blueprintId: existing ? body.blueprintId : null,
      deviceId: device.id,
      action: "push",
      direction: "up",
      status: "denied",
      errorMessage: "no write grant",
      createdAt: new Date(),
    });
    return forbidden("this device has no write grant for that blueprint");
  }

  const head = existing
    ? (
        await db
          .select()
          .from(blueprintVersion)
          .where(eq(blueprintVersion.blueprintId, body.blueprintId))
          .orderBy(desc(blueprintVersion.version))
          .limit(1)
      )[0]
    : undefined;

  const first = body.commits[0]!;
  const known = new Set(
    existing
      ? (
          await db
            .select({ sha: blueprintVersion.commitSha })
            .from(blueprintVersion)
            .where(eq(blueprintVersion.blueprintId, body.blueprintId))
        ).map((row) => row.sha)
      : [],
  );

  // Everything already here: an exact re-push, so say so instead of erroring.
  const fresh = body.commits.filter((commit) => !known.has(commit.sha));
  if (fresh.length === 0) {
    return NextResponse.json({ success: true, applied: 0, head: head?.commitSha ?? null, upToDate: true });
  }

  // Fast-forward only. If the first new commit does not build on our head, the two
  // histories have diverged and the client has to merge before it can push.
  const base = fresh[0]!.parentSha;
  if (head && base !== head.commitSha) {
    return NextResponse.json(
      {
        error: "diverged",
        serverHead: head.commitSha,
        // The client needs this to pick a merge base: its own history will not contain
        // `serverHead` (that is what diverged means) but it very likely contains the
        // commit that one was built on.
        serverParent: head.parentSha,
        serverVersion: head.version,
        serverDoc: JSON.parse(head.metadata) as unknown,
      },
      { status: 409 },
    );
  }
  if (!head && base !== null && !known.has(base)) {
    // First push of a blueprint whose earlier history the server never received.
    // Accepted: the device is the source of truth, this is just where the mirror starts.
  }

  const now = new Date();
  const last = fresh.at(-1)!;
  let version = head?.version ?? 0;

  await db.transaction(async (tx) => {
    if (!existing) {
      await tx.insert(blueprint).values({
        id: body.blueprintId,
        name: body.name,
        createdAt: first.at ?? now,
        updatedAt: now,
        createdBy: device.userId,
        metadata: JSON.stringify(last.doc),
        workstationId: device.workstationId,
        version: version + fresh.length,
        hash: sha256(JSON.stringify(last.doc)),
        syncStatus: "synced",
        lastSyncedAt: now,
        deviceId: device.id,
      });
    } else {
      await tx
        .update(blueprint)
        .set({
          name: body.name,
          updatedAt: now,
          metadata: JSON.stringify(last.doc),
          version: version + fresh.length,
          hash: sha256(JSON.stringify(last.doc)),
          syncStatus: "synced",
          lastSyncedAt: now,
          deviceId: device.id,
        })
        .where(eq(blueprint.id, body.blueprintId));
    }

    for (const commit of fresh) {
      version += 1;
      await tx.insert(blueprintVersion).values({
        id: `bpv_${nanoid(16)}`,
        blueprintId: body.blueprintId,
        version,
        metadata: JSON.stringify(commit.doc),
        hash: sha256(JSON.stringify(commit.doc)),
        commitSha: commit.sha,
        parentSha: commit.parentSha,
        message: commit.message,
        deviceId: device.id,
        createdBy: device.userId,
        createdAt: commit.at ?? now,
      });
    }

    await tx.insert(syncLog).values({
      id: `syn_${nanoid(16)}`,
      blueprintId: body.blueprintId,
      deviceId: device.id,
      action: "push",
      direction: "up",
      status: "ok",
      versionBefore: head?.version ?? 0,
      versionAfter: version,
      createdAt: now,
    });
  });

  const response = { success: true, applied: fresh.length, head: last.sha, version };

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
