import { existsSync } from "node:fs"
import { openFeed, REMOTE_CAMERA } from "./camera.ts"
import type { Roi } from "./detect.ts"
import type { Frame, Hand, Label } from "./gestures.ts"

export { REMOTE_CAMERA, splitJpegs } from "./camera.ts"

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

export type RemoteStats = { state: "connecting" | "live" | "reconnecting"; fps: number; rttMs: number }

/** A camera feed goes over the wire, so anything but localhost must be TLS. */
export function assertSecureUrl(baseUrl: string): URL {
  const url = new URL(baseUrl)
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.protocol !== "https:" && !local) {
    throw new Error(`refusing to stream the camera to ${url.origin} — hand drawing needs https`)
  }
  return url
}

/** An answer retrying cannot change: the device was revoked, or the server has no model. */
export class Fatal extends Error {}

const tickets = new Map<string, { value?: string; expiresAt: number; request?: Promise<string> }>()

/**
 * A short-lived ticket for the device token, shared by every caller in the process. Checking
 * the token is a database query, which neither a frame nor a live find can afford; the ticket
 * is an HMAC. `stale` is a ticket the server just refused: refresh unless someone already has.
 */
export function ticketFor(base: string, token: string, stale?: string): Promise<string> {
  const key = `${base} ${token}`
  const entry = tickets.get(key) ?? { expiresAt: 0 }
  tickets.set(key, entry)
  if (entry.value && entry.value !== stale && entry.expiresAt - Date.now() > 60_000) return Promise.resolve(entry.value)
  entry.request ??= (async () => {
    const response = await fetch(`${base}/api/device/hand/ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    })
    if (response.status === 401) throw new Fatal("this device is no longer authorised — run `jarvis pair`")
    if (!response.ok) throw new Error(`ticket request failed: ${response.status}`)
    const body = (await response.json()) as { ticket: string; expiresAt: number }
    entry.value = body.ticket
    entry.expiresAt = body.expiresAt
    return body.ticket
  })().finally(() => {
    entry.request = undefined
  })
  return entry.request
}

/**
 * Hands from the web API: the webcam is captured here, the model runs on the server.
 *
 * Latency is the whole game, so nothing ever queues. Capture overwrites one "latest frame"
 * slot; `inFlight` sender loops each POST the newest frame nobody has sent yet; a response
 * older than one already yielded is dropped. Worst-case lag is therefore one round trip,
 * whatever the network does — a slow link lowers the frame rate instead of building delay.
 *
 * The device token is exchanged once for a short-lived ticket, because checking the token
 * is a database query and a frame cannot afford one. The server is stateless: the ROI from
 * the last answer is sent back with the next frame, so any instance can serve any frame.
 */
export function remoteSource(options: {
  baseUrl: string
  token: string
  camera?: Camera
  inFlight?: number
  onStats?: (stats: RemoteStats) => void
  /** Test seam: an MJPEG byte stream in place of ffmpeg. */
  capture?: () => ReadableStream<Uint8Array>
}): HandSource {
  const base = assertSecureUrl(options.baseUrl).origin
  const camera = options.camera ?? REMOTE_CAMERA
  const inFlight = options.inFlight ?? 2
  const abort = new AbortController()
  let feed: ReturnType<typeof openFeed> | undefined
  let stopped = false

  return {
    camera,
    async *frames() {
      const waiters: (() => void)[] = []
      const wait = () => new Promise<void>((resolve) => waiters.push(resolve))
      const wake = () => {
        for (const resolve of waiters.splice(0)) resolve()
      }

      let latest: { jpeg: Uint8Array<ArrayBuffer>; t: number; seq: number } | undefined
      let taken = -1
      let yielded = -1
      let roi: Roi | undefined
      // ponytail: echoed like the ROI, so with `inFlight` requests out the trail skips frames
      // (the model is trained on 0.5–2× speed for that). Make it client-built from the returned
      // landmarks if remote motion accuracy ever lags the local worker's.
      let trail: string | undefined
      let sinceDetect = 0
      let fatal: Error | undefined
      const ready: Frame[] = []
      const started = performance.now()
      let rtt = 0
      const answered: number[] = []
      let state: RemoteStats["state"] = "connecting"
      const report = () => {
        const now = performance.now()
        while (answered.length > 0 && now - answered[0]! > 1000) answered.shift()
        options.onStats?.({ state, fps: answered.length, rttMs: Math.round(rtt) })
      }
      report()

      const captureLoop = async () => {
        try {
          feed = openFeed(camera, { capture: options.capture })
          let shot = await feed.next()
          while (!stopped) {
            latest = { jpeg: shot.jpeg, t: Math.max(0, Math.round(shot.at - started)), seq: shot.seq }
            wake()
            shot = await feed.next(shot.seq)
          }
        } catch (error) {
          if (!stopped) fatal = error instanceof Error ? error : new Error(String(error))
        }
        wake()
      }

      const send = async (frame: { jpeg: Uint8Array<ArrayBuffer>; t: number; seq: number }) => {
        const detect = roi === undefined || sinceDetect >= 15
        sinceDetect = detect ? 0 : sinceDetect + 1
        const headers: Record<string, string> = { "content-type": "image/jpeg", "x-hand-detect": detect ? "1" : "0" }
        if (roi && !detect) headers["x-hand-roi"] = [roi.x, roi.y, roi.w, roi.h].map((n) => n.toFixed(1)).join(",")
        if (trail) headers["x-hand-trail"] = trail
        const post = async (value: string) =>
          fetch(`${base}/api/device/hand`, {
            method: "POST",
            headers: { ...headers, authorization: `Bearer ${value}` },
            body: frame.jpeg,
            signal: abort.signal,
          })
        const sentAt = performance.now()
        let value = await ticketFor(base, options.token)
        let response = await post(value)
        if (response.status === 401) {
          value = await ticketFor(base, options.token, value)
          response = await post(value)
          if (response.status === 401) throw new Fatal("the server refused a fresh ticket — run `jarvis pair`")
        }
        if (response.status === 503) throw new Fatal("the hand model is not installed on the server — see web/models/hand/README.md")
        if (!response.ok) throw new Error(`hand server: ${response.status}`)
        const body = (await response.json()) as { hands: Hand[]; roi?: Roi; trail?: string; motion?: Label }
        rtt = rtt === 0 ? performance.now() - sentAt : rtt * 0.8 + (performance.now() - sentAt) * 0.2
        answered.push(performance.now())
        state = "live"
        report()
        // An answer that arrives after a newer one is history; yielding it would jump backwards.
        if (frame.seq <= yielded) return
        yielded = frame.seq
        roi = body.roi
        trail = body.trail
        ready.push({ t: frame.t, hands: body.hands, motion: body.motion })
        wake()
      }

      const sender = async () => {
        let failures = 0
        while (!stopped && !fatal) {
          if (!latest || latest.seq <= taken) {
            await wait()
            continue
          }
          const frame = latest
          taken = frame.seq
          try {
            await send(frame)
            failures = 0
          } catch (error) {
            if (stopped) return
            if (error instanceof Fatal) {
              fatal = error
              wake()
              return
            }
            // Network trouble: say so, back off, and carry on with whatever frame is newest then.
            failures += 1
            roi = undefined
            trail = undefined
            state = "reconnecting"
            report()
            await Bun.sleep(Math.min(4000, 250 * 2 ** (failures - 1)))
          }
        }
      }

      void captureLoop()
      for (let i = 0; i < inFlight; i++) void sender()

      while (!stopped) {
        const next = ready.shift()
        if (next) {
          yield next
          continue
        }
        if (fatal) throw fatal
        await wait()
      }
    },
    close() {
      stopped = true
      abort.abort()
      feed?.release()
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
