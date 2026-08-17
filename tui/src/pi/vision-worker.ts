#!/usr/bin/env bun
/**
 * Palm detection and hand landmarks, emitting one NDJSON object per frame on stdout.
 *
 * Runs as its own process so a native-addon crash costs a restartable child rather than the
 * daemon, and so the same file can be run under `node` if `onnxruntime-node` misbehaves
 * under Bun on arm64 — which is the single biggest unknown in this pipeline.
 *
 * Frames come from an external binary in both cases: `rpicam-vid` on a Pi, `ffmpeg` on
 * anything else. Neither is our code, both are already installed on their platform, and
 * both hand us raw RGB on stdout.
 */
import {
  assertAnchorCount,
  clampRoi,
  cropToTensor,
  decodeDetections,
  generateAnchors,
  landmarksToCamera,
  nms,
  PALM_ANCHORS,
  roiFromPalm,
  type Box,
  type Roi,
} from "./detect.ts"
import { modelPaths } from "./models.ts"

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
 * The camera command. `rpicam-vid` is the Raspberry Pi stack's own tool; `ffmpeg` covers a
 * laptop webcam so the whole pipeline is developable without a Pi. Both are asked for
 * packed RGB24 so no colour conversion happens in TypeScript.
 */
function cameraCommand(args: Args): string[] {
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
  const input =
    process.platform === "darwin"
      ? ["-f", "avfoundation", "-framerate", String(args.fps), "-i", "0"]
      : ["-f", "v4l2", "-framerate", String(args.fps), "-i", "/dev/video0"]
  return [
    "ffmpeg",
    "-hide_banner",
    "-loglevel", "error",
    ...input,
    "-vf", `scale=${args.width}:${args.height}`,
    "-pix_fmt", "rgb24",
    "-f", "rawvideo",
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

  const palm = await ort.InferenceSession.create(models.palm)
  const landmark = await ort.InferenceSession.create(models.landmark)
  const anchors = generateAnchors(PALM_ANCHORS)

  const PALM_INPUT = PALM_ANCHORS.inputSize
  const LANDMARK_INPUT = 224

  const palmBuffer = new Float32Array(3 * PALM_INPUT * PALM_INPUT)
  const landmarkBuffer = new Float32Array(3 * LANDMARK_INPUT * LANDMARK_INPUT)
  const rgb = new Uint8Array(args.width * args.height * 3)

  const yuv = args.source === "rpicam"
  const child = Bun.spawn(cameraCommand(args), { stdout: "pipe", stderr: "inherit" })
  emit({ ready: true, camera: { ...camera, fps: args.fps } })

  let checked = false
  let roi: Roi | undefined
  let sinceDetect = 0
  const started = performance.now()

  for await (const raw of fixedFrames(child.stdout, bytesPerFrame(args, yuv))) {
    const frame = yuv ? yuvToRgb(raw, args.width, args.height, rgb) : raw
    const t = Math.round(performance.now() - started)

    // Detect only when the hand is lost or every half second: the landmark model tracks
    // fine on its own, and re-detecting every frame is what makes this too slow for a Pi.
    const needDetect = roi === undefined || sinceDetect >= Math.max(1, Math.round(args.fps / 2))
    if (needDetect) {
      sinceDetect = 0
      cropToTensor(frame, camera, { x: 0, y: 0, w: args.width, h: args.height }, PALM_INPUT, palmBuffer)
      const output = await palm.run({
        [palm.inputNames[0]!]: new ort.Tensor("float32", palmBuffer, [1, 3, PALM_INPUT, PALM_INPUT]),
      })
      const tensors = palm.outputNames.map((name) => output[name]!)
      // Scores are the single-channel output; regressors are the wider one.
      const [scoresTensor, boxesTensor] =
        (tensors[0]!.dims.at(-1) ?? 1) === 1 ? [tensors[0]!, tensors[1]!] : [tensors[1]!, tensors[0]!]

      const scores = scoresTensor.data as Float32Array
      if (!checked) {
        assertAnchorCount(scores.length, anchors)
        checked = true
      }
      const found: Box[] = nms(
        decodeDetections(boxesTensor.data as Float32Array, scores, anchors, {
          inputSize: PALM_INPUT,
          threshold: 0.5,
        }),
        0.3,
        2,
      )
      roi = found[0] ? clampRoi(roiFromPalm(found[0], camera), camera) : undefined
    } else {
      sinceDetect += 1
    }

    if (!roi) {
      emit({ t, hands: [] })
      continue
    }

    cropToTensor(frame, camera, roi, LANDMARK_INPUT, landmarkBuffer)
    const output = await landmark.run({
      [landmark.inputNames[0]!]: new ort.Tensor("float32", landmarkBuffer, [1, 3, LANDMARK_INPUT, LANDMARK_INPUT]),
    })
    // The landmark model emits a 63-value tensor plus a presence score; pick them by size
    // rather than by name, since the exported names differ between conversions.
    const outputs = landmark.outputNames.map((name) => output[name]!)
    const coords = outputs.find((tensor) => tensor.data.length >= 63)
    const presence = outputs.find((tensor) => tensor.data.length === 1)
    if (!coords) die("the landmark model produced no coordinate tensor")

    const score = presence ? Math.min(1, Math.max(0, (presence.data as Float32Array)[0] ?? 1)) : 1
    const landmarks = landmarksToCamera(coords!.data as Float32Array, roi, { inputSize: LANDMARK_INPUT })

    // A confident hand keeps its ROI for the next frame; a lost one forces a re-detect.
    if (score < 0.5) roi = undefined

    emit({ t, hands: score >= 0.5 ? [{ score, landmarks }] : [] })
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)))
}
