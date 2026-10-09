import { DEFAULT_THRESHOLD, locate } from "@pi/items.ts";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { visionItem } from "~/server/db/schemas/vision_item";
import { callerFor, decodeJpeg, getEmbedder, modelMissing, unpackBank } from "~/server/vision";

/**
 * Finds taught items in one photo: a raw `image/jpeg` body in, boxes in its pixels out.
 *
 *   ?item=<id or name>  only that item (default: every item in the workstation)
 *   ?threshold=0.65     how alike a patch must be to count (`DEFAULT_THRESHOLD`); `best` in
 *                       the answer says how close a miss came, so this can be tuned per camera
 *
 * Auth is the device token or, faster, the hand ticket: a live find calls this every frame
 * it can, and the item query runs alongside the model rather than before it.
 *
 * The photo is decoded, run and dropped. Nothing is stored or logged.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 2_000_000;
const round = (value: number, places = 0) => Math.round(value * 10 ** places) / 10 ** places;

export async function POST(request: Request) {
  const caller = await callerFor(request, "vision:read");
  if (caller instanceof NextResponse) return caller;

  if (request.headers.get("content-type") !== "image/jpeg") {
    return NextResponse.json({ error: "expected image/jpeg" }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return NextResponse.json({ error: "photo too large", limit: MAX_BYTES }, { status: 413 });
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "photo too large", limit: MAX_BYTES }, { status: 413 });
  }

  const params = new URL(request.url).searchParams;
  const threshold = params.has("threshold") ? Number(params.get("threshold")) : DEFAULT_THRESHOLD;
  if (!(threshold >= 0 && threshold <= 1)) {
    return NextResponse.json({ error: "invalid_request", detail: "threshold must be between 0 and 1" }, { status: 400 });
  }
  const wanted = params.get("item");

  const rgb = decodeJpeg(body);
  if (!rgb) return NextResponse.json({ error: "not a decodable JPEG" }, { status: 400 });

  const query = db
    .select({ id: visionItem.id, name: visionItem.name, pos: visionItem.pos, neg: visionItem.neg })
    .from(visionItem)
    .where(
      and(
        eq(visionItem.workstationId, caller.workstationId),
        wanted ? or(eq(visionItem.id, wanted), eq(visionItem.name, wanted)) : undefined,
      ),
    );
  const started = performance.now();
  const embedding = getEmbedder().then((embedder) => embedder.embed(rgb.data, rgb));
  // Not left unhandled while the query is still out; the await below reports it.
  embedding.catch(() => undefined);

  const items = await query;
  if (items.length === 0) {
    return NextResponse.json({ error: wanted ? "no such item" : "no items taught yet" }, { status: 404 });
  }

  let scene: Awaited<typeof embedding>;
  try {
    scene = await embedding;
  } catch (error) {
    return modelMissing(error);
  }

  const found = items.map((item) => {
    const { best, boxes } = locate(scene, { pos: unpackBank(item.pos), neg: unpackBank(item.neg) }, threshold);
    return {
      id: item.id,
      name: item.name,
      found: boxes.length > 0,
      best: round(best, 3),
      boxes: boxes.map((box) => ({ x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h), score: round(box.score, 3) })),
    };
  });
  return NextResponse.json(
    { items: found, ms: Math.round(performance.now() - started) },
    { headers: { "cache-control": "no-store" } },
  );
}
