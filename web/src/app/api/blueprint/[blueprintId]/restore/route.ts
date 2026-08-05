import { BlueprintDocSchema } from "@blueprint/schema.ts";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { syncLog } from "~/server/db/schemas/sync_log";
import { requireBlueprint } from "~/server/blueprint-access";
import { sha256 } from "~/server/device-auth";

const bodySchema = z.object({ ref: z.string().min(1).max(64) });

/**
 * Restores an old version by *appending* a new one with the same content.
 *
 * History is append-only: nothing is rewritten, and the restore itself shows up as an
 * event on the timeline. The new version has no `commitSha` — it did not come from a
 * device's git repo — which is exactly what makes the next device push treat it as a
 * divergence and merge against it instead of silently overwriting it.
 */
export async function POST(request: Request, ctx: { params: Promise<{ blueprintId: string }> }) {
  const { blueprintId } = await ctx.params;
  const access = await requireBlueprint(request, blueprintId);
  if (access instanceof NextResponse) return access;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const version = /^v\d+$/.test(body.ref) ? Number(body.ref.slice(1)) : undefined;
  const source = (
    await db
      .select()
      .from(blueprintVersion)
      .where(
        and(
          eq(blueprintVersion.blueprintId, access.blueprint.id),
          version === undefined
            ? eq(blueprintVersion.commitSha, body.ref)
            : eq(blueprintVersion.version, version),
        ),
      )
      .limit(1)
  )[0];
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = BlueprintDocSchema.safeParse(JSON.parse(source.metadata));
  if (!parsed.success) return NextResponse.json({ error: "stored version is not a valid blueprint" }, { status: 422 });

  const head = (
    await db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.blueprintId, access.blueprint.id))
      .orderBy(desc(blueprintVersion.version))
      .limit(1)
  )[0];

  if (head && head.version === source.version) {
    return NextResponse.json({ error: "already_current", version: head.version }, { status: 409 });
  }

  const now = new Date();
  const nextVersion = (head?.version ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx.insert(blueprintVersion).values({
      id: `bpv_${nanoid(16)}`,
      blueprintId: access.blueprint.id,
      version: nextVersion,
      metadata: source.metadata,
      hash: sha256(source.metadata),
      commitSha: null,
      parentSha: head?.commitSha ?? null,
      message: `restore v${source.version}${source.commitSha ? ` (${source.commitSha})` : ""}`,
      deviceId: null,
      createdBy: access.userId,
      createdAt: now,
    });

    await tx
      .update(blueprint)
      .set({
        metadata: source.metadata,
        version: nextVersion,
        hash: sha256(source.metadata),
        updatedAt: now,
        // The devices are now behind; their next sync has to reconcile.
        syncStatus: "pending",
      })
      .where(eq(blueprint.id, access.blueprint.id));

    await tx.insert(syncLog).values({
      id: `syn_${nanoid(16)}`,
      blueprintId: access.blueprint.id,
      deviceId: null,
      action: "restore",
      direction: "down",
      status: "ok",
      versionBefore: head?.version ?? 0,
      versionAfter: nextVersion,
      createdAt: now,
    });
  });

  return NextResponse.json({ success: true, version: nextVersion, restoredFrom: source.version });
}
