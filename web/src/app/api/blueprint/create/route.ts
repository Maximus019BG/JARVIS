import { DEFAULT_VIEW_BOX, emptyDoc, serialize } from "@blueprint/schema.ts";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "~/lib/auth";
import { BLUEPRINT_NAME_RE } from "~/lib/blueprint-name";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { appendBlueprintVersion } from "~/server/blueprint-write";
import { ownsWorkstation } from "~/server/ownership";

/**
 * Creates a blueprint from the browser.
 *
 * The row id *is* the document id: `tui/src/blueprint/sync.ts` pushes and pulls keyed on
 * `doc.id`, so a blueprint whose row id differs from its document id would be created here
 * and then duplicated the first time a device touched it.
 */
const bodySchema = z.object({
  workstationId: z.string().min(1),
  name: z.string().regex(BLUEPRINT_NAME_RE, "lowercase letters, digits and hyphens"),
  units: z.enum(["mm", "cm", "in", "px"]).default("mm"),
  viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).default(DEFAULT_VIEW_BOX),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : "invalid request";
    return NextResponse.json({ error: message ?? "invalid_request" }, { status: 400 });
  }

  if (!(await ownsWorkstation(session.user.id, body.workstationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [, , width, height] = body.viewBox;
  if (width <= 0 || height <= 0) {
    return NextResponse.json({ error: "sheet must have a positive width and height" }, { status: 400 });
  }

  // Names are filenames on every device that syncs this workstation, so two blueprints
  // called the same thing under one workstation would collide on the first pull.
  const clash = (
    await db
      .select({ id: blueprint.id })
      .from(blueprint)
      .where(and(eq(blueprint.workstationId, body.workstationId), eq(blueprint.name, body.name)))
      .limit(1)
  )[0];
  if (clash) return NextResponse.json({ error: `"${body.name}" already exists here` }, { status: 409 });

  const id = `bp_${nanoid(16)}`;
  const doc = { ...emptyDoc(body.name, body.viewBox, body.units), id };
  const now = new Date();

  await db.insert(blueprint).values({
    id,
    name: body.name,
    createdAt: now,
    updatedAt: now,
    createdBy: session.user.id,
    metadata: null,
    workstationId: body.workstationId,
  });

  // The row goes in empty and the first version fills it, so creation lands on the same
  // append-only path as every other write and shows up on the timeline as v1.
  const { version } = await appendBlueprintVersion({
    blueprintId: id,
    metadata: serialize(doc),
    message: "create",
    action: "create",
    userId: session.user.id,
  });

  return NextResponse.json(
    { success: true, id, name: body.name, version, createdBy: session.user.id },
    { status: 201 },
  );
}
