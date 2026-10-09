import { ItemError, learn, type Patches } from "@pi/items.ts";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/server/db";
import { visionItem } from "~/server/db/schemas/vision_item";
import { decodeJpeg, deviceFor, getEmbedder, modelMissing, packBank } from "~/server/vision";

/**
 * Items a device teaches its workstation to find, from a few photos with a box around the
 * item in each. The photos are embedded and dropped; only the patch features are kept.
 *
 *   POST   { name, images: [{ jpeg: base64, box: [x, y, w, h] }] }  teach (or re-teach) one
 *   GET                                                             list
 *   DELETE ?id=                                                     forget one
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/** 20 base64 photos at ~350KB each, under nginx's 10m body cap. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const bodySchema = z.object({
  name: z.string().trim().min(1).max(64),
  images: z
    .array(
      z.object({
        jpeg: z.string().min(1),
        /** Where the item is in that photo, in its pixels: left, top, width, height. */
        box: z.tuple([z.number().finite(), z.number().finite(), z.number().positive(), z.number().positive()]),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(request: Request) {
  const device = await deviceFor(request, "vision:write");
  if (device instanceof NextResponse) return device;

  const declared = Number(request.headers.get("content-length") ?? 0);
  const raw = declared > MAX_BODY_BYTES ? "" : await request.text();
  if (declared > MAX_BODY_BYTES || raw.length > MAX_BODY_BYTES) {
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

  let embedder: Awaited<ReturnType<typeof getEmbedder>>;
  try {
    embedder = await getEmbedder();
  } catch (error) {
    return modelMissing(error);
  }

  const samples: { patches: Patches; box: { x: number; y: number; w: number; h: number } }[] = [];
  for (const [index, image] of body.images.entries()) {
    const rgb = decodeJpeg(Buffer.from(image.jpeg, "base64"));
    if (!rgb) return NextResponse.json({ error: "invalid_image", detail: `photo ${index} is not a decodable JPEG` }, { status: 400 });
    const [x, y, w, h] = image.box;
    let patches: Patches;
    try {
      patches = await embedder.embed(rgb.data, rgb);
    } catch (error) {
      // Only the model can fail here: the photo already decoded.
      return modelMissing(error);
    }
    samples.push({ patches, box: { x, y, w, h } });
  }

  let item: ReturnType<typeof learn>;
  try {
    item = learn(samples);
  } catch (error) {
    if (error instanceof ItemError) return NextResponse.json({ error: "invalid_image", detail: error.message }, { status: 400 });
    throw error;
  }

  const now = new Date();
  const taught = { deviceId: device.id, samples: samples.length, pos: packBank(item.pos), neg: packBank(item.neg), updatedAt: now };
  const [row] = await db
    .insert(visionItem)
    .values({ id: `vit_${nanoid(16)}`, workstationId: device.workstationId, createdBy: device.userId, name: body.name, createdAt: now, ...taught })
    .onConflictDoUpdate({ target: [visionItem.workstationId, visionItem.name], set: taught })
    .returning({ id: visionItem.id });
  return NextResponse.json({ id: row!.id, name: body.name, samples: samples.length });
}

export async function GET(request: Request) {
  const device = await deviceFor(request, "vision:read");
  if (device instanceof NextResponse) return device;

  const items = await db
    .select({ id: visionItem.id, name: visionItem.name, samples: visionItem.samples, updatedAt: visionItem.updatedAt })
    .from(visionItem)
    .where(eq(visionItem.workstationId, device.workstationId))
    .orderBy(visionItem.name);
  return NextResponse.json({ items });
}

export async function DELETE(request: Request) {
  const device = await deviceFor(request, "vision:write");
  if (device instanceof NextResponse) return device;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "invalid_request", detail: "?id= is required" }, { status: 400 });

  const removed = await db
    .delete(visionItem)
    .where(and(eq(visionItem.id, id), eq(visionItem.workstationId, device.workstationId)))
    .returning({ id: visionItem.id });
  if (removed.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
