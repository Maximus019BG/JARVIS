import path from "node:path";
import { createTracker, type Ort, type Tracker } from "@pi/track.ts";
import jpeg from "jpeg-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyTicket } from "~/server/hand/ticket";

/**
 * Hand tracking for the TUI's freehand tool: one webcam JPEG in, 21 landmarks per hand out.
 *
 * Deliberately free of the database. A frame arrives ~20 times a second, so auth is the
 * HMAC ticket from `./ticket`, and tracking state lives on the client: it echoes back the
 * ROI from the previous answer, so any warm instance can serve any frame.
 *
 * The frame is decoded, run and dropped. Nothing is stored or logged; it is a camera feed.
 */
export const runtime = "nodejs";
export const maxDuration = 10;
// Latency is dominated by the round trip, so this route wants to run near the people
// drawing, not near the database it never touches. e.g. "fra1".
// export const preferredRegion = "fra1";

/** Where to drop the models. Traced into the function by `outputFileTracingIncludes`. */
const MODEL_DIR = path.join(process.cwd(), "models", "hand");
const MAX_BYTES = 300_000;

const roiSchema = z
  .string()
  .transform((value) => value.split(",").map(Number))
  .pipe(z.tuple([z.number().finite(), z.number().finite(), z.number().positive(), z.number().positive()]))
  .transform(([x, y, w, h]) => ({ x, y, w, h }));

let tracker: Promise<Tracker> | undefined;
const getTracker = () =>
  (tracker ??= (async () => {
    const ort = await import("onnxruntime-node");
    return createTracker(ort as unknown as Ort, {
      palm: path.join(MODEL_DIR, "palm_detection.onnx"),
      landmark: path.join(MODEL_DIR, "hand_landmark.onnx"),
    });
  })().catch((error: unknown) => {
    // A missing model must not be cached forever: the next request tries again.
    tracker = undefined;
    throw error;
  }));

/**
 * One inference at a time per instance. The tracker reuses its tensor buffers, and a second
 * request filling them mid-run would corrupt the first; inference is CPU-bound anyway, so
 * running two at once on one instance is no faster.
 * ponytail: per-instance queue. Fluid compute adds instances under load; a pool of trackers
 * if one instance ever has spare cores to use.
 */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "").trim() ?? "";
  if (!verifyTicket(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (request.headers.get("content-type") !== "image/jpeg") {
    return NextResponse.json({ error: "expected image/jpeg" }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return NextResponse.json({ error: "frame too large" }, { status: 413 });
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "frame too large" }, { status: 413 });
  }

  const roiHeader = request.headers.get("x-hand-roi");
  const roi = roiHeader ? roiSchema.safeParse(roiHeader) : undefined;
  if (roi && !roi.success) return NextResponse.json({ error: "invalid x-hand-roi" }, { status: 400 });
  const detect = request.headers.get("x-hand-detect") === "1";

  let image: { width: number; height: number; data: Uint8Array };
  try {
    // The resolution and memory caps are the decompression-bomb guard: a tiny JPEG can
    // claim to be enormous, and the decoder would allocate for the claim.
    image = jpeg.decode(body, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 1.3, maxMemoryUsageInMB: 64 });
  } catch {
    return NextResponse.json({ error: "not a decodable JPEG" }, { status: 400 });
  }

  let active: Tracker;
  try {
    active = await getTracker();
  } catch (error) {
    console.error("hand tracker failed to load:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "hand model is not installed on the server" }, { status: 503 });
  }

  const started = performance.now();
  const camera = { width: image.width, height: image.height };
  const result = await serial(() => active.step(image.data, camera, { roi: roi?.data, detect }));
  return NextResponse.json(
    { ...result, ms: Math.round(performance.now() - started) },
    { headers: { "cache-control": "no-store" } },
  );
}
