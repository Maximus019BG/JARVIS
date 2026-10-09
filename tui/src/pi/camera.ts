import { ffmpegAsset, ffmpegBinary, fetchFfmpeg } from "./ffmpeg.ts"
import type { Camera } from "./hand-source.ts"
import { ffmpegInput, fitFilter } from "./vision-worker.ts"

/** Smaller than the local default: every frame crosses the internet. */
export const REMOTE_CAMERA: Camera = { width: 480, height: 360, fps: 30 }

/** One webcam JPEG. `at` is `performance.now()` when it arrived. */
export type Shot = { jpeg: Uint8Array<ArrayBuffer>; seq: number; at: number }

/**
 * The webcam as a stream of JPEGs, shared by everything that looks through it: gestures,
 * the freehand pen, the /learn and /find preview and the agent's `find_item`. One ffmpeg for
 * all of them, because v4l2 lets only one process open a camera, and a camera that is
 * already running answers a find with no warm-up.
 */
export type Feed = {
  readonly camera: Camera
  /** When the camera started, on the `performance.now()` clock. */
  readonly since: number
  latest(): Shot | undefined
  /** The first frame newer than `after`; rejects once the camera has stopped. */
  next(after?: number): Promise<Shot>
  /** Idempotent. The camera itself stops once nobody holds it for `LINGER_MS`. */
  release(): void
}

/** Long enough that "and where is it now?" a moment later finds the camera still warm. */
const LINGER_MS = 10_000

/**
 * How long a camera may stay silent before it counts as failed. A camera whose app lacks
 * permission on macOS opens fine and then never sends a frame; long enough to click Allow.
 */
const FIRST_FRAME_MS = 15_000

/**
 * Capture processes still running, killed when the TUI exits. A healthy ffmpeg dies on its
 * own once nobody reads its output, but one stuck waiting for a first frame never writes, so
 * never notices, and keeps the camera from the next run.
 */
const capturing = new Set<{ kill(): void }>()
process.once("exit", () => {
  for (const child of capturing) child.kill()
})

const INSTALL: Record<string, string> = {
  darwin: "brew install ffmpeg",
  win32: "winget install Gyan.FFmpeg, then open a new terminal",
  linux: "sudo apt install ffmpeg (a Pi camera module uses rpicam-apps, preinstalled on Raspberry Pi OS)",
}

/** What to say when no camera tool is installed and none could be fetched. */
export const noCameraTool = (platform: string = process.platform): string =>
  `no camera tool found — install ffmpeg: ${INSTALL[platform] ?? INSTALL.linux}`

let notice: (message: string) => void = () => {}

/** Who hears about the one-time ffmpeg fetch: the app, as a toast. */
export function onCameraNotice(listener: (message: string) => void): void {
  notice = listener
}

/**
 * The commands that can read this machine's camera, best first, each writing mirrored JPEGs
 * to stdout. A Pi camera module only speaks libcamera, so `rpicam-vid` goes first on Linux;
 * when it finds no module (a USB webcam on a Pi) the feed falls through to ffmpeg.
 */
export function cameraCommands(
  camera: Camera,
  options: {
    override?: string
    platform?: string
    has?: (bin: string) => boolean
    /** Path to ffmpeg, or undefined for none: PATH, then the fetched copy. */
    ffmpeg?: string
    windowsCamera?: () => string | undefined
  } = {},
): string[][] {
  if (options.override?.trim()) return [options.override.trim().split(/\s+/)]
  const platform = options.platform ?? process.platform
  const has = options.has ?? ((bin: string) => Bun.which(bin) !== null)
  const ffmpeg = "ffmpeg" in options ? options.ffmpeg : ffmpegBinary()
  const { width, height, fps } = camera
  const commands: string[][] = []
  if (platform === "linux" && has("rpicam-vid")) {
    // prettier-ignore
    commands.push([
      "rpicam-vid", "--timeout", "0", "--nopreview",
      "--width", String(width), "--height", String(height), "--framerate", String(fps),
      "--hflip", "--codec", "mjpeg", "--quality", "70", "--output", "-",
    ])
  }
  if (ffmpeg) {
    // Mirrored, so moving your hand right moves the pen right; JPEG, because raw RGB at
    // 30fps is ~27MB/s and this is going over the internet. `passthrough` because ffmpeg
    // otherwise "fills" AVFoundation's timestamp jumps by repeating one frame thousands of
    // times a second, and the feed's newest frame is then seconds old.
    // prettier-ignore
    commands.push([
      ffmpeg, "-hide_banner", "-loglevel", "error",
      ...ffmpegInput(fps, platform, options.windowsCamera),
      "-fps_mode", "passthrough", "-vf", `${fitFilter(width, height)},hflip`, "-c:v", "mjpeg", "-q:v", "6", "-f", "image2pipe", "-",
    ])
  }
  return commands
}

let override: string | undefined

/**
 * `vision.camera`: a command writing MJPEG to stdout, in place of the probe — for a second
 * webcam, or one the probe picks wrong. Applies from the next time the camera starts.
 */
export function setCameraOverride(command: string | undefined): void {
  override = command
}

/** The last thing a capture tool said before giving up: the only useful part of its log. */
async function lastWords(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text = (text + decoder.decode(value, { stream: true })).slice(-2000)
    }
  } catch {
    // The process was killed mid-write; what arrived is still worth reporting.
  }
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim()).filter(Boolean)
  return lines.slice(-2).join(" / ")
}

/** Index of the next `FF <marker>` pair at or after `from`, or -1. */
function findMarker(buffer: Uint8Array, marker: number, from: number): number {
  for (let i = from; i < buffer.length - 1; i++) if (buffer[i] === 0xff && buffer[i + 1] === marker) return i
  return -1
}

/**
 * Cuts an MJPEG byte stream into single JPEGs on SOI (FFD8) / EOI (FFD9). Safe without a
 * real parser: inside entropy-coded data a literal FF is always stuffed as FF00, so FFD9
 * only ever appears as the end marker, and ffmpeg writes no EXIF thumbnails.
 */
export async function* splitJpegs(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader()
  let buffer: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      const joined = new Uint8Array(buffer.length + value.length)
      joined.set(buffer)
      joined.set(value, buffer.length)
      buffer = joined
      let start = findMarker(buffer, 0xd8, 0)
      while (start >= 0) {
        const end = findMarker(buffer, 0xd9, start + 2)
        if (end < 0) break
        yield buffer.slice(start, end + 2)
        buffer = buffer.subarray(end + 2)
        start = findMarker(buffer, 0xd8, 0)
      }
      // Keep a partial frame; with no SOI at all keep only a trailing FF that may be half of one.
      buffer = start >= 0 ? buffer.subarray(start) : buffer.subarray(Math.max(0, buffer.length - 1))
    }
  } finally {
    reader.releaseLock()
  }
}

type Live = {
  camera: Camera
  since: number
  latest?: Shot
  error?: Error
  waiters: { after: number; resolve: (shot: Shot) => void; reject: (error: Error) => void }[]
  users: number
  linger?: ReturnType<typeof setTimeout>
  stop: () => void
}

function start(camera: Camera, capture?: () => ReadableStream<Uint8Array>): Live {
  let child: ReturnType<typeof Bun.spawn> | undefined
  let stopped = false
  const live: Live = {
    camera,
    since: performance.now(),
    waiters: [],
    users: 0,
    stop: () => {
      stopped = true
      child?.kill()
      fail(new Error("the camera was closed"))
    },
  }
  const fail = (error: Error) => {
    live.error ??= error
    for (const waiter of live.waiters.splice(0)) waiter.reject(live.error)
  }

  /** Publishes every frame of one capture; resolves with how many there were. */
  const pump = async (stream: ReadableStream<Uint8Array>, onFirst?: () => void): Promise<number> => {
    let frames = 0
    for await (const jpeg of splitJpegs(stream)) {
      if (stopped) break
      if (frames === 0) onFirst?.()
      const shot = { jpeg, seq: frames++, at: performance.now() }
      live.latest = shot
      const due = live.waiters.filter((waiter) => waiter.after < shot.seq)
      live.waiters = live.waiters.filter((waiter) => waiter.after >= shot.seq)
      for (const waiter of due) waiter.resolve(shot)
    }
    return frames
  }
  const stoppedAfter = (frames: number) =>
    fail(new Error(frames > 0 ? "the camera stopped — is it still connected?" : "the camera gave no picture"))

  /** Tries each command in turn; true once one has run (and since stopped), else the problems. */
  const attempt = async (commands: string[][], problems: string[]): Promise<boolean> => {
    for (const command of commands) {
      let spawned: ReturnType<typeof Bun.spawn>
      try {
        spawned = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
      } catch {
        problems.push(`${command[0]} would not start`)
        continue
      }
      child = spawned
      capturing.add(spawned)
      void spawned.exited.then(() => capturing.delete(spawned))
      const said = lastWords(spawned.stderr as ReadableStream<Uint8Array>)
      let silent = false
      const timer = setTimeout(() => {
        silent = true
        spawned.kill()
      }, FIRST_FRAME_MS)
      const frames = await pump(spawned.stdout as ReadableStream<Uint8Array>, () => clearTimeout(timer))
      clearTimeout(timer)
      if (stopped) return true
      // A camera that worked and then stopped is unplugged, not wrongly chosen: no fallback.
      if (frames > 0) {
        stoppedAfter(frames)
        return true
      }
      const last = await said
      problems.push(`${command[0]}: ${silent ? `opened, but no picture in ${FIRST_FRAME_MS / 1000}s` : last || "no picture"}`)
    }
    return false
  }

  void (async () => {
    try {
      if (capture) return stoppedAfter(await pump(capture()))
      const problems: string[] = []
      if (await attempt(cameraCommands(camera, { override }), problems)) return
      // Nothing installed could do it: fetch our own ffmpeg, once, and try that.
      const asset = ffmpegAsset()
      if (!override && !ffmpegBinary() && asset) {
        notice(`fetching ffmpeg for the camera — once, ${asset.mb} MB…`)
        try {
          await fetchFfmpeg()
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          return fail(new Error(`${reason}. ${noCameraTool()}`))
        }
        notice("ffmpeg ready")
        const ffmpegOnly = cameraCommands(camera, { has: () => false })
        if (await attempt(ffmpegOnly, problems)) return
      }
      if (problems.length === 0) return fail(new Error(noCameraTool()))
      const permission =
        process.platform === "darwin" ? " — allow your terminal in System Settings → Privacy & Security → Camera" : ""
      fail(new Error(`the camera did not start (${problems.join("; ")})${permission}`))
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })()
  return live
}

let shared: Live | undefined

/**
 * A handle on the shared camera, starting it if nobody has. The first opener's size wins;
 * every caller asks for `REMOTE_CAMERA`. `capture` is the test seam: a private feed over
 * that stream instead of ffmpeg, never shared.
 */
export function openFeed(camera: Camera = REMOTE_CAMERA, options: { capture?: () => ReadableStream<Uint8Array> } = {}): Feed {
  let live: Live
  if (options.capture) live = start(camera, options.capture)
  else {
    if (!shared || shared.error) shared = start(camera)
    live = shared
  }
  clearTimeout(live.linger)
  live.users += 1

  let released = false
  return {
    camera: live.camera,
    since: live.since,
    latest: () => live.latest,
    next: (after = -1) => {
      if (live.latest && live.latest.seq > after) return Promise.resolve(live.latest)
      if (live.error) return Promise.reject(live.error)
      return new Promise((resolve, reject) => live.waiters.push({ after, resolve, reject }))
    },
    release: () => {
      if (released) return
      released = true
      live.users -= 1
      if (live.users > 0) return
      const stop = () => {
        live.stop()
        if (shared === live) shared = undefined
      }
      if (options.capture) return stop()
      live.linger = setTimeout(stop, LINGER_MS)
      live.linger.unref?.()
    },
  }
}

/**
 * A frame worth looking at: the first one at least `settleMs` after the camera started, so
 * a cold webcam has finished adjusting its exposure. A warm camera answers at once.
 */
export async function snapshot(feed: Feed, settleMs = 700): Promise<Shot> {
  let shot = await feed.next()
  while (shot.at - feed.since < settleMs) shot = await feed.next(shot.seq)
  return shot
}
