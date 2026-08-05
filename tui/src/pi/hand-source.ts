import { existsSync } from "node:fs"
import type { Frame, Hand } from "./gestures.ts"

export type Camera = { width: number; height: number; fps: number }

/**
 * Where hands come from. The one seam that matters in this phase: the ONNX worker, a
 * recorded file and a synthetic script all satisfy it, and swapping detection onto the
 * IMX500's on-sensor accelerator later means writing one more of these and nothing else.
 */
export type HandSource = {
  readonly camera: Camera
  frames(): AsyncIterable<Frame>
  close(): void
}

export const DEFAULT_CAMERA: Camera = { width: 640, height: 480, fps: 30 }

/** One NDJSON line from the vision worker. */
type WorkerLine =
  | { t: number; hands: Hand[] }
  | { ready: true; camera: Camera }
  | { error: string }

const isFrame = (line: WorkerLine): line is { t: number; hands: Hand[] } => "hands" in line

/**
 * Reads newline-delimited JSON off a stream. The worker emits one object per frame, so a
 * partial line at the end of a chunk is normal and has to be carried over.
 */
async function* ndjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<WorkerLine> {
  // An explicit reader rather than `for await`: ReadableStream is async-iterable in Bun but
  // not in the TypeScript DOM lib, and this form is correct in every runtime.
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) {
          try {
            yield JSON.parse(line) as WorkerLine
          } catch {
            // A half-written line, or a stray log the worker wrote to the wrong stream.
            // Dropping it beats killing the pipeline mid-stroke.
          }
        }
        newline = buffer.indexOf("\n")
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Spawns the vision worker and reads landmarks from its stdout.
 *
 * A separate process on purpose. `onnxruntime-node` is a native addon and the single
 * biggest unknown on arm64; isolating it means a crash or a Bun/N-API incompatibility
 * costs one restartable child rather than the whole daemon, and the same file can be run
 * under Node instead of Bun without touching anything else.
 */
export function onnxSource(options: {
  runtime?: string
  script?: string
  camera?: Camera
  source?: string
}): HandSource {
  const script = options.script ?? new URL("./vision-worker.ts", import.meta.url).pathname
  const camera = options.camera ?? DEFAULT_CAMERA
  const child = Bun.spawn(
    [
      options.runtime ?? "bun",
      script,
      `--width=${camera.width}`,
      `--height=${camera.height}`,
      `--fps=${camera.fps}`,
      `--source=${options.source ?? "rpicam"}`,
    ],
    { stdout: "pipe", stderr: "inherit" },
  )

  return {
    camera,
    async *frames() {
      for await (const line of ndjson(child.stdout)) {
        if ("error" in line) throw new Error(`vision worker: ${line.error}`)
        if (isFrame(line)) yield { t: line.t, hands: line.hands }
      }
    },
    close() {
      child.kill()
    },
  }
}

/** Replays a recorded NDJSON capture, for debugging a gesture without the hardware. */
export function replaySource(path: string, camera: Camera = DEFAULT_CAMERA): HandSource {
  if (!existsSync(path)) throw new Error(`no recording at ${path}`)
  let stop = false
  return {
    camera,
    async *frames() {
      const text = await Bun.file(path).text()
      const lines = text.split("\n").filter((line) => line.trim())
      let previous: number | undefined
      for (const line of lines) {
        if (stop) return
        const parsed = JSON.parse(line) as { t: number; hands: Hand[] }
        // Replay at the original pace so hold-based gestures behave as recorded.
        if (previous !== undefined) await Bun.sleep(Math.max(0, Math.min(200, parsed.t - previous)))
        previous = parsed.t
        yield parsed
      }
    },
    close() {
      stop = true
    },
  }
}

/** Places a 21-landmark hand at a point, with a given pinch gap and finger count. */
export function syntheticHand(options: {
  x: number
  y: number
  pinch: number
  fingers: number
  span?: number
  score?: number
}): Hand {
  const { x, y, pinch, fingers, span = 70, score = 0.95 } = options
  const landmarks = Array.from({ length: 21 }, () => ({ x, y }))
  landmarks[0] = { x, y: y + span }
  landmarks[9] = { x, y }
  landmarks[5] = { x: x - 14, y }
  landmarks[17] = { x: x + 14, y }
  const place = (tip: number, pip: number, dx: number, extended: boolean) => {
    landmarks[pip] = { x: x + dx, y: y - span * 0.25 }
    landmarks[tip] = { x: x + dx, y: extended ? y - span * 0.8 : y + span * 0.5 }
  }
  place(8, 6, -14, fingers >= 1)
  place(12, 10, 0, fingers >= 2)
  place(16, 14, 9, fingers >= 3)
  place(20, 18, 18, fingers >= 4)
  const index = landmarks[8]!
  landmarks[4] = { x: index.x + pinch * span, y: index.y }
  return { score, landmarks }
}

export type ScriptStep = {
  /** Where the pinch point should be, in camera pixels. */
  to: [number, number]
  /** Frames spent travelling there. */
  frames: number
  pinch?: number
  fingers?: number
}

/**
 * A scripted hand, so the whole pipeline — gestures, calibration, fitting, committing —
 * can be exercised end to end on a laptop with no camera and no model files. This is what
 * makes phase 3 testable before any hardware exists.
 */
export function scriptedSource(
  steps: readonly ScriptStep[],
  camera: Camera = DEFAULT_CAMERA,
  /**
   * Emit frames at the camera's frame rate rather than as fast as possible. On for the
   * `--source=script` demo, where the projector needs wall-clock time to show anything;
   * off in tests, which would otherwise spend seconds sleeping per case.
   */
  options: { paced?: boolean } = {},
): HandSource {
  let stop = false
  return {
    camera,
    async *frames() {
      let at: [number, number] = steps[0]?.to ?? [camera.width / 2, camera.height / 2]
      let t = 0
      const interval = Math.round(1000 / camera.fps)
      const span = 70
      for (const step of steps) {
        const from: [number, number] = [...at]
        for (let i = 1; i <= step.frames; i++) {
          if (stop) return
          const progress = i / step.frames
          at = [from[0] + (step.to[0] - from[0]) * progress, from[1] + (step.to[1] - from[1]) * progress]
          t += interval
          const fingers = step.fingers ?? 1
          const pinch = step.pinch ?? 1
          // `to` means where the *pinch point* should be, not where the wrist is — that is
          // the coordinate the gesture reader emits and therefore the one a caller is
          // reasoning about. Placing the hand so the fingers land on it is what makes this
          // source usable for checking the camera-to-sheet mapping end to end.
          if (options.paced) await Bun.sleep(interval)
          if (fingers < 0) {
            yield { t, hands: [] }
            continue
          }
          // The compensation above assumes an extended index finger, which is where the
          // pinch point is measured from. A curled hand (fingers: 0, i.e. a fist) is
          // position-independent — it means undo — so the small offset there is harmless.
          const hand = syntheticHand({
            x: at[0] + 14 - (pinch * span) / 2,
            y: at[1] + span * 0.8,
            pinch,
            fingers,
            span,
          })
          yield { t, hands: [hand] }
        }
      }
    },
    close() {
      stop = true
    },
  }
}
