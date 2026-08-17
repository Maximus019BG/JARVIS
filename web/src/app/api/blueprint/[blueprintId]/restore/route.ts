import { BlueprintDocSchema } from "@blueprint/schema.ts";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/server/db";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { requireBlueprint } from "~/server/blueprint-access";
import { appendBlueprintVersion } from "~/server/blueprint-write";

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
      .select({ version: blueprintVersion.version })
      .from(blueprintVersion)
      .where(eq(blueprintVersion.blueprintId, access.blueprint.id))
      .orderBy(desc(blueprintVersion.version))
      .limit(1)
  )[0];

  if (head && head.version === source.version) {
    return NextResponse.json({ error: "already_current", version: head.version }, { status: 409 });
  }

  const created = await appendBlueprintVersion({
    blueprintId: access.blueprint.id,
    metadata: source.metadata,
    message: `restore v${source.version}${source.commitSha ? ` (${source.commitSha})` : ""}`,
    action: "restore",
    userId: access.userId,
  });

  return NextResponse.json({ success: true, version: created.version, restoredFrom: source.version });
}
