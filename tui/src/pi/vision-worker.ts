#!/usr/bin/env bun
/**
 * Palm detection and hand landmarks, emitting one NDJSON object per frame on stdout.
 *
 * Runs as its own process so a native-addon crash costs a restartable child rather than the
 * daemon, and so the same file can be run under `node` if `onnxruntime-node` misbehaves
 * under Bun on arm64 — which is the single biggest unknown in this pipeline.
 *
 * Frames come from an external binary in both cases: `rpicam-vid` on a Pi, `ffmpeg` on
 * anything else (macOS, Windows, Linux webcams). Neither is our code, and both hand us raw
 * frames on stdout.
 */
import type { Roi, TrailPoint } from "./detect.ts"
import { fetchFfmpeg, ffmpegBinary } from "./ffmpeg.ts"
import { gesturePaths, modelPaths } from "./models.ts"
import { createTracker, type GestureLabels, type Ort } from "./track.ts"

type Args = { width: number; height: number; fps: number; source: string }

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] ?? fallback
  return {
    width: Number(get("width", "640")),
    height: Number(get("height", "480")),
    fps: Number(get("fps", "30")),
    source: get("source", "rpicam"),
  }
}

const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
const die = (message: string): never => {
  emit({ error: message })
  process.exit(1)
}

/**
 * Camera names in `ffmpeg -list_devices true -f dshow -i dummy` output, video only. ffmpeg 5+
 * tags each line `(video)`; older builds list them under a "DirectShow video devices" header,
 * each followed by an "Alternative name" line that is not a name anyone would pick.
 */
export function parseDshowCameras(listing: string): string[] {
  const tagged = [...listing.matchAll(/"([^"]+)"\s+\(video\)/g)].map((match) => match[1]!)
  if (tagged.length > 0) return tagged
  const section = listing.split(/DirectShow audio devices/i)[0]?.split(/DirectShow video devices/i)[1] ?? ""
  return [...section.matchAll(/\]\s+"([^"]+)"/g)].map((match) => match[1]!)
}

/** The first DirectShow camera, by name: the only way ffmpeg addresses a camera on Windows. */
function dshowCamera(ffmpeg = ffmpegBinary() ?? "ffmpeg"): string | undefined {
  try {
    const listed = Bun.spawnSync([ffmpeg, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
      stdout: "ignore",
      stderr: "pipe",
    })
    return parseDshowCameras(listed.stderr.toString())[0]
  } catch {
    return undefined
  }
}

/**
 * ffmpeg's input for this OS's camera API: AVFoundation, DirectShow or Video4Linux. No frame
 * rate on Windows, where DirectShow refuses any rate the camera does not offer exactly.
 */
export function ffmpegInput(
  fps: number,
  platform: string = process.platform,
  windowsCamera: () => string | undefined = dshowCamera,
): string[] {
  // nv12 named outright: ffmpeg 6 asks AVFoundation for yuv420p, which a FaceTime camera
  // refuses, and ffmpeg then spins without ever delivering a frame or exiting.
  if (platform === "darwin") return ["-f", "avfoundation", "-pixel_format", "nv12", "-framerate", String(fps), "-i", "0"]
  if (platform === "win32") return ["-f", "dshow", "-i", `video=${windowsCamera() ?? "no camera found"}`]
  return ["-f", "v4l2", "-framerate", String(fps), "-i", "/dev/video0"]
}

/**
 * Crops the camera's picture to the requested aspect, then scales: a 16:9 webcam stretched
 * to 4:3 squashes every hand by a quarter, and both the landmark and gesture models read
 * shape. Commas inside `min()` are escaped because they also separate filters.
 */
export const fitFilter = (width: number, height: number): string =>
  `crop=min(iw\\,ih*${width}/${height}):min(ih\\,iw*${height}/${width}),scale=${width}:${height}`

/**
 * The camera command for this worker. `rpicam-vid` is the Raspberry Pi stack's own tool;
 * `ffmpeg` covers a laptop webcam so the whole pipeline is developable without a Pi. Both are
 * asked for raw frames so no colour conversion happens in TypeScript beyond rpicam's YUV.
 */
export function cameraCommand(args: Args): string[] {
  if (args.source === "rpicam") {
    return [
      "rpicam-vid",
      "--timeout", "0",
      "--nopreview",
      "--width", String(args.width),
      "--height", String(args.height),
      "--framerate", String(args.fps),
      "--codec", "yuv420",
      "--flush",
      "--output", "-",
    ]
  }
  return [
    ffmpegBinary() ?? "ffmpeg",
    "-hide_banner",
    "-loglevel", "error",
    ...ffmpegInput(args.fps),
    "-fps_mode", "passthrough", "-vf", fitFilter(args.width, args.height), "-pix_fmt", "rgb24", "-f", "rawvideo",
    "-",
  ]
}

/** rpicam's yuv420 needs converting; ffmpeg already gives us rgb24. */
const bytesPerFrame = (args: Args, yuv: boolean) =>
  yuv ? (args.width * args.height * 3) / 2 : args.width * args.height * 3

/**
 * YUV420 planar to packed RGB. Only the luma plane carries detail the models care about,
 * but they expect three channels, so chroma is upsampled by nearest neighbour — which is
 * what the 2×2 subsampling already implies anyway.
 */
function yuvToRgb(yuv: Uint8Array, width: number, height: number, out: Uint8Array): Uint8Array {
  const uOffset = width * height
  const vOffset = uOffset + (width * height) / 4
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const luma = yuv[y * width + x] ?? 0
      const chromaIndex = (y >> 1) * (width >> 1) + (x >> 1)
      const u = (yuv[uOffset + chromaIndex] ?? 128) - 128
      const v = (yuv[vOffset + chromaIndex] ?? 128) - 128
      const at = (y * width + x) * 3
      out[at] = Math.min(255, Math.max(0, luma + 1.402 * v))
      out[at + 1] = Math.min(255, Math.max(0, luma - 0.344 * u - 0.714 * v))
      out[at + 2] = Math.min(255, Math.max(0, luma + 1.772 * u))
    }
  }
  return out
}

/** Reads exactly `size` bytes at a time out of a byte stream. */
async function* fixedFrames(stream: ReadableStream<Uint8Array>, size: number): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let held = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      chunks.push(value)
      held += value.length
      while (held >= size) {
        const joined = new Uint8Array(held)
        let at = 0
        for (const piece of chunks) {
          joined.set(piece, at)
          at += piece.length
        }
        chunks.length = 0
        yield joined.subarray(0, size)
        const rest = joined.slice(size)
        held = rest.length
        if (held > 0) chunks.push(rest)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const camera = { width: args.width, height: args.height }

  let ort: typeof import("onnxruntime-node")
  try {
    ort = await import("onnxruntime-node")
  } catch {
    die(
      "onnxruntime-node is not installed. On the Pi: `bun add onnxruntime-node` " +
        "(or run this worker with `--runtime=node` if the Bun build fails).",
    )
    return
  }

  const models = modelPaths()
  for (const [name, path] of Object.entries(models)) {
    if (!(await Bun.file(path).exists())) {
      die(`missing model ${name} at ${path} — run \`jarvis pi models\` to fetch them`)
    }
  }

  const gesture = (await Bun.file(gesturePaths.model).exists())
    ? { path: gesturePaths.model, labels: (await Bun.file(gesturePaths.labels).json()) as GestureLabels }
    : undefined
  const tracker = await createTracker(ort as unknown as Ort, models, gesture)
  const rgb = new Uint8Array(args.width * args.height * 3)

  const yuv = args.source === "rpicam"
  if (!yuv && !ffmpegBinary()) {
    process.stderr.write("no ffmpeg on PATH — fetching one (once)…\n")
    await fetchFfmpeg()
  }
  const child = Bun.spawn(cameraCommand(args), { stdout: "pipe", stderr: "inherit" })
  emit({ ready: true, camera: { ...camera, fps: args.fps } })

  let roi: Roi | undefined
  let trail: TrailPoint[] | undefined
  let sinceDetect = 0
  const started = performance.now()

  for await (const raw of fixedFrames(child.stdout, bytesPerFrame(args, yuv))) {
    const frame = yuv ? yuvToRgb(raw, args.width, args.height, rgb) : raw
    const t = Math.round(performance.now() - started)

    // Detect only when the hand is lost or every half second: the landmark model tracks
    // fine on its own, and re-detecting every frame is what makes this too slow for a Pi.
    const detect = roi === undefined || sinceDetect >= Math.max(1, Math.round(args.fps / 2))
    sinceDetect = detect ? 0 : sinceDetect + 1
    const result = await tracker.step(frame, camera, { roi, detect, trail })
    roi = result.roi
    trail = result.trail
    emit({ t, hands: result.hands, motion: result.motion })
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)))
}
