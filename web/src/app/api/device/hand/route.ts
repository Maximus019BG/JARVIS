import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TrailPoint } from "@pi/detect.ts";
import { createTracker, type GestureLabels, type Tracker } from "@pi/track.ts";
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

/**
 * One region per tracked hand, as the previous answer returned them: `x,y,w,h;…`. A single
 * region is the header an older TUI sends, and still parses. Two is the tracker's limit.
 */
const roiSchema = z
  .string()
  .transform((value) => value.split(";").map((roi) => roi.split(",").map(Number)))
  .pipe(
    z
      .array(z.tuple([z.number().finite(), z.number().finite(), z.number().positive(), z.number().positive()]))
      .max(2),
  )
  .transform((rois) => rois.map(([x, y, w, h]) => ({ x, y, w, h })));

/**
 * The motion trail the previous answer returned, echoed back like the ROI: `x,y,span;…`.
 * The cap is a trust-boundary limit, not the model's window — the tracker trims to that.
 */
const trailSchema = z
  .string()
  .transform((value) => value.split(";").map((point) => point.split(",").map(Number)))
  .pipe(z.array(z.tuple([z.number().finite(), z.number().finite(), z.number().positive().finite()])).max(64));
const formatTrail = (trail: TrailPoint[] | undefined) =>
  trail?.map((point) => point.map((n) => n.toFixed(1)).join(",")).join(";");

/**
 * The learned gesture model is optional: without it the route still returns landmarks. Both
 * files or neither — labels without the model would fail the tracker, and every frame with it.
 */
const loadGesture = async () => {
  const model = path.join(MODEL_DIR, "hand_gesture.onnx");
  const labels = await readFile(path.join(MODEL_DIR, "hand_gesture.json"), "utf8").catch(() => undefined);
  return labels && existsSync(model) ? { path: model, labels: JSON.parse(labels) as GestureLabels } : undefined;
};

let tracker: Promise<Tracker> | undefined;
const getTracker = () =>
  (tracker ??= (async () => {
    const ort = await import("onnxruntime-node");
    return createTracker(
      ort,
      {
        palm: path.join(MODEL_DIR, "palm_detection.onnx"),
        landmark: path.join(MODEL_DIR, "hand_landmark.onnx"),
      },
      await loadGesture(),
    );
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
  const rois = roiHeader ? roiSchema.safeParse(roiHeader) : undefined;
  if (rois && !rois.success) return NextResponse.json({ error: "invalid x-hand-roi" }, { status: 400 });
  const trailHeader = request.headers.get("x-hand-trail");
  const trail = trailHeader ? trailSchema.safeParse(trailHeader) : undefined;
  if (trail && !trail.success) return NextResponse.json({ error: "invalid x-hand-trail" }, { status: 400 });
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

  const camera = { width: image.width, height: image.height };
  // `ms` is inference only, measured inside the queue: time spent waiting behind another
  // frame is load, not model speed.
  const { result, ms } = await serial(async () => {
    const started = performance.now();
    const result = await active.step(image.data, camera, { rois: rois?.data, detect, trail: trail?.data });
    return { result, ms: Math.round(performance.now() - started) };
  });
  return NextResponse.json(
    { ...result, trail: formatTrail(result.trail), ms },
    { headers: { "cache-control": "no-store" } },
  );
}
