import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { syncLog } from "~/server/db/schemas/sync_log";
import { sha256 } from "~/server/device-auth";

/**
 * Appends a version to a blueprint's history and points the blueprint at it.
 *
 * History is append-only: nothing is rewritten, and the write shows up as an event on the
 * timeline. The new version has no `commitSha` — it did not come from a device's git repo —
 * which is exactly what makes the next device push treat it as a divergence and merge
 * against it instead of silently overwriting it.
 *
 * Shared by the restore route and the MCP edit tool, because "what a web-side write does to
 * the sync state" is not something two call sites should each decide.
 *
 * `metadata` must already be the canonical `serialize(doc)` text — the hash is taken over it
 * verbatim, and a differently-formatted copy of the same drawing would read as a change.
 */
export async function appendBlueprintVersion(args: {
  blueprintId: string;
  metadata: string;
  message: string;
  /** What the sync log calls this. `restore`, `edit`, … */
  action: string;
  userId: string;
  deviceId?: string | null;
}): Promise<{ version: number; previousVersion: number }> {
  const head = (
    await db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.blueprintId, args.blueprintId))
      .orderBy(desc(blueprintVersion.version))
      .limit(1)
  )[0];

  const now = new Date();
  const version = (head?.version ?? 0) + 1;
  const hash = sha256(args.metadata);

  await db.transaction(async (tx) => {
    await tx.insert(blueprintVersion).values({
      id: `bpv_${nanoid(16)}`,
      blueprintId: args.blueprintId,
      version,
      metadata: args.metadata,
      hash,
      commitSha: null,
      parentSha: head?.commitSha ?? null,
      message: args.message,
      deviceId: args.deviceId ?? null,
      createdBy: args.userId,
      createdAt: now,
    });

    await tx
      .update(blueprint)
      .set({
        metadata: args.metadata,
        version,
        hash,
        updatedAt: now,
        // The devices are now behind; their next sync has to reconcile.
        syncStatus: "pending",
      })
      .where(eq(blueprint.id, args.blueprintId));

    await tx.insert(syncLog).values({
      id: `syn_${nanoid(16)}`,
      blueprintId: args.blueprintId,
      deviceId: args.deviceId ?? null,
      action: args.action,
      direction: "down",
      status: "ok",
      versionBefore: head?.version ?? 0,
      versionAfter: version,
      createdAt: now,
    });
  });

  return { version, previousVersion: head?.version ?? 0 };
}
