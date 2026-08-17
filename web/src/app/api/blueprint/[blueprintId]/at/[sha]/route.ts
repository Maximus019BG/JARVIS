import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { requireBlueprint } from "~/server/blueprint-access";

/** One historical document. `sha` may be a commit sha or `v<number>`. */
export async function GET(request: Request, ctx: { params: Promise<{ blueprintId: string; sha: string }> }) {
  const { blueprintId, sha } = await ctx.params;
  const access = await requireBlueprint(request, blueprintId);
  if (access instanceof NextResponse) return access;

  const version = /^v\d+$/.test(sha) ? Number(sha.slice(1)) : undefined;
  const row = (
    await db
      .select()
      .from(blueprintVersion)
      .where(
        and(
          eq(blueprintVersion.blueprintId, access.blueprint.id),
          version === undefined ? eq(blueprintVersion.commitSha, sha) : eq(blueprintVersion.version, version),
        ),
      )
      .limit(1)
  )[0];

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    success: true,
    version: row.version,
    commitSha: row.commitSha,
    message: row.message,
    createdAt: row.createdAt,
    doc: JSON.parse(row.metadata) as unknown,
  });
}
