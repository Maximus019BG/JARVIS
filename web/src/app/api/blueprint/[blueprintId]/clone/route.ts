import { serialize } from "@blueprint/schema.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";

import { BLUEPRINT_NAME_RE } from "~/lib/blueprint-name";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { requireBlueprint } from "~/server/blueprint-access";
import { docFromMetadata } from "~/server/blueprint-legacy";
import { appendBlueprintVersion } from "~/server/blueprint-write";

const bodySchema = z.object({ name: z.string().regex(BLUEPRINT_NAME_RE).optional() });

/**
 * A copy starts its own history at v1 rather than inheriting the original's — it is a
 * different drawing from here on, and a shared timeline would make the next device sync
 * try to reconcile two blueprints that have nothing to do with each other.
 */
export async function POST(request: Request, ctx: { params: Promise<{ blueprintId: string }> }) {
  const { blueprintId } = await ctx.params;
  const access = await requireBlueprint(request, blueprintId);
  if (access instanceof NextResponse) return access;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { doc: source } = docFromMetadata(access.blueprint.metadata, access.blueprint.name);
  if (!source) return NextResponse.json({ error: "nothing to copy" }, { status: 422 });

  const taken = new Set(
    (
      await db
        .select({ name: blueprint.name })
        .from(blueprint)
        .where(eq(blueprint.workstationId, access.blueprint.workstationId))
    ).map((row) => row.name),
  );
  let name = body.name ?? `${access.blueprint.name}-copy`;
  for (let n = 2; taken.has(name); n += 1) name = `${body.name ?? `${access.blueprint.name}-copy`}-${n}`;

  const id = `bp_${nanoid(16)}`;
  const now = new Date();
  await db.insert(blueprint).values({
    id,
    name,
    createdAt: now,
    updatedAt: now,
    createdBy: access.userId,
    metadata: null,
    workstationId: access.blueprint.workstationId,
  });

  await appendBlueprintVersion({
    blueprintId: id,
    metadata: serialize({ ...source, id, name }),
    message: `copy of ${access.blueprint.name}`,
    action: "clone",
    userId: access.userId,
  });

  return NextResponse.json({ success: true, id, name }, { status: 201 });
}
