import { diffDocs, summarise } from "@blueprint/diff.ts";
import { BlueprintDocSchema } from "@blueprint/schema.ts";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { requireBlueprint } from "~/server/blueprint-access";

async function load(blueprintId: string, ref: string) {
  const version = /^v\d+$/.test(ref) ? Number(ref.slice(1)) : undefined;
  const row = (
    await db
      .select()
      .from(blueprintVersion)
      .where(
        and(
          eq(blueprintVersion.blueprintId, blueprintId),
          version === undefined ? eq(blueprintVersion.commitSha, ref) : eq(blueprintVersion.version, version),
        ),
      )
      .limit(1)
  )[0];
  if (!row) return undefined;
  const parsed = BlueprintDocSchema.safeParse(JSON.parse(row.metadata));
  return parsed.success ? { row, doc: parsed.data } : undefined;
}

/**
 * Entity-level diff between two versions, computed with the same `diffDocs` the merge
 * relies on — so what the web shows as changed is exactly what a merge would treat as
 * changed. Serving both documents alongside it lets the client draw the overlay without
 * a second round trip.
 */
export async function GET(request: Request, ctx: { params: Promise<{ blueprintId: string }> }) {
  const { blueprintId } = await ctx.params;
  const access = await requireBlueprint(request, blueprintId);
  if (access instanceof NextResponse) return access;

  const params = new URL(request.url).searchParams;
  const a = params.get("a");
  const b = params.get("b");
  if (!a || !b) return NextResponse.json({ error: "a and b are required" }, { status: 400 });

  const [before, after] = await Promise.all([load(access.blueprint.id, a), load(access.blueprint.id, b)]);
  if (!before || !after) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const diff = diffDocs(before.doc, after.doc);

  return NextResponse.json({
    success: true,
    summary: summarise(diff),
    counts: diff.counts,
    a: { version: before.row.version, commitSha: before.row.commitSha, doc: before.doc },
    b: { version: after.row.version, commitSha: after.row.commitSha, doc: after.doc },
    // Entities only; the client already has both documents for the geometry itself.
    changes: diff.entities
      .filter((change) => change.kind !== "unchanged")
      .map((change) => ({
        kind: change.kind,
        id: change.id,
        type: "after" in change ? change.after.type : change.before.type,
        layer: "after" in change ? change.after.layer : change.before.layer,
      })),
    layers: diff.layers.map((change) => ({ kind: change.kind, id: change.id })),
    viewBox: diff.viewBox ?? null,
  });
}
