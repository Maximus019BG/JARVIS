import { applyOps, OpSchema } from "@blueprint/ops.ts";
import { BlueprintError, serialize } from "@blueprint/schema.ts";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { BLUEPRINT_NAME_RE } from "~/lib/blueprint-name";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { requireBlueprint } from "~/server/blueprint-access";
import { docFromMetadata } from "~/server/blueprint-legacy";
import { appendBlueprintVersion } from "~/server/blueprint-write";

/**
 * The browser's edit path, and deliberately the same one `blueprint_edit` uses over MCP:
 * ops in, `applyOps`, `appendBlueprintVersion` out. Sending operations rather than a whole
 * document is what makes a web save survive a device push that landed mid-session — and
 * what keeps the server from having to trust a client-assembled document at all.
 */
const bodySchema = z.object({
  ops: z.array(OpSchema).max(2000).default([]),
  message: z.string().max(500).optional(),
  name: z.string().regex(BLUEPRINT_NAME_RE).optional(),
  /** Head the client edited against. Omit only when overwriting deliberately. */
  expectedVersion: z.number().int().positive().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ blueprintId: string }> }) {
  const { blueprintId } = await ctx.params;
  const access = await requireBlueprint(request, blueprintId);
  if (access instanceof NextResponse) return access;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : "invalid request";
    return NextResponse.json({ error: message ?? "invalid_request" }, { status: 400 });
  }

  // A device may have pushed while the editor was open. Refusing here is the difference
  // between the user resolving a conflict and silently losing someone else's work.
  if (body.expectedVersion !== undefined && body.expectedVersion !== access.blueprint.version) {
    return NextResponse.json(
      { error: "stale", serverVersion: access.blueprint.version },
      { status: 409 },
    );
  }

  if (body.ops.length === 0 && !body.name) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }

  const { doc } = docFromMetadata(access.blueprint.metadata, access.blueprint.name);
  if (!doc) {
    return NextResponse.json({ error: "this blueprint has no readable content" }, { status: 422 });
  }

  let next, summary;
  try {
    // `applyOps` never mutates its input and rejects unknown ids outright, so a bad batch
    // leaves the stored document exactly as it was.
    ({ doc: next, summary } = applyOps(doc, body.ops));
  } catch (error) {
    const message = error instanceof BlueprintError ? error.message : "could not apply the edit";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  if (body.name && body.name !== access.blueprint.name) {
    next = { ...next, name: body.name };
    await db.update(blueprint).set({ name: body.name }).where(eq(blueprint.id, access.blueprint.id));
  }

  // Serialize once and hand the client back exactly what was stored — the canonical form
  // rounds coordinates, and an editor holding unrounded ones would report itself dirty
  // against the version it just saved.
  const metadata = serialize(next);
  const { version } = await appendBlueprintVersion({
    blueprintId: access.blueprint.id,
    metadata,
    message: body.message ?? summary,
    action: "edit",
    userId: access.userId,
  });

  return NextResponse.json({ success: true, version, summary, doc: JSON.parse(metadata) as unknown });
}
