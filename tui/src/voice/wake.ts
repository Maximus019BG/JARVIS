/**
 * Always-on wake word: "hey jarvis" without touching the keyboard.
 *
 * The shape here is deliberately the one `src/pi/` already proved. A `WakeSource` is the seam:
 * an ONNX worker in its own process, or a scripted one that emits scores on a timeline. The
 * scoring is somebody else's neural network; everything in this file is the part that decides
 * what a stream of scores *means*, and it is pure so it can be tested without a microphone.
 */

/** One scored moment. `t` is milliseconds since the listener started. */
export type WakeScore = { t: number; score: number }

export type WakeSource = {
  scores(): AsyncIterable<WakeScore>
  close(): void
}

export const SAMPLE_RATE = 16_000
/** openWakeWord's chunk: 1280 samples at 16 kHz, so a score every 80 ms once warmed up. */
export const CHUNK_SAMPLES = 1280

/**
 * Samples of the previous chunk to prepend before each melspectrogram call.
 *
 * Measured, not guessed. That model emits `samples / 160 - 3` frames, so calling it on
 * independent 1280-sample chunks silently drops three frames — 30 ms — at every boundary, and
 * the classifier gets a time-compressed phrase it was never trained on. Feeding the last 480
 * samples back in front restores the three hops of context it needs: the frames then come out
 * bit-identical to one continuous call over the whole stream, at the eight per chunk
 * openWakeWord documents.
 */
export const MEL_CONTEXT_SAMPLES = 480

export type WakeSettings = {
  /** Score above which the phrase counts as heard. Higher is fewer false alarms. */
  threshold: number
  /** Consecutive chunks over the threshold before it fires. One chunk is 80 ms. */
  frames: number
  /** How long to ignore the microphone after firing, so one "hey jarvis" wakes once. */
  refractoryMs: number
}

export const DEFAULT_WAKE: WakeSettings = { threshold: 0.5, frames: 2, refractoryMs: 2000 }

/**
 * Turns a stream of scores into wake events.
 *
 * Two rules, and both exist because of a specific failure. **Consecutive frames**: the score
 * spikes over threshold on a single chunk for all sorts of things that are not the phrase, and
 * requiring two in a row costs 80 ms of latency to remove most of them. **A refractory
 * window**: a real utterance scores high for most of a second, which without this fires ten
 * times and starts ten recordings.
 *
 * A pure generator over a pure input, so the whole decision is testable against a list of
 * numbers.
 */
export async function* detections(
  scores: AsyncIterable<WakeScore>,
  settings: WakeSettings = DEFAULT_WAKE,
): AsyncGenerator<WakeScore> {
  let over = 0
  let until = -Infinity
  for await (const sample of scores) {
    if (sample.t < until) {
      // Still inside the window from the last hit. Reset the run too, so the tail of the same
      // utterance cannot carry over and fire the instant the window expires.
      over = 0
      continue
    }
    if (sample.score < settings.threshold) {
      over = 0
      continue
    }
    over += 1
    if (over < settings.frames) continue
    over = 0
    until = sample.t + settings.refractoryMs
    yield sample
  }
}

/**
 * A running listener. `pause` exists for two independent reasons and both are load-bearing:
 * the microphone is usually an exclusive device, so push-to-talk cannot open it while this
 * holds it; and a wake word that hears the assistant's own text-to-speech will wake itself up.
 */
export type WakeListener = {
  /** Stop scoring, without giving up the process. Safe to call when already paused. */
  pause: () => void
  resume: () => void
  readonly paused: boolean
  close: () => void
}

/**
 * Reads a source and calls `onWake`, until closed.
 *
 * Errors are reported rather than thrown: this runs behind a terminal that is doing something
 * else, and a wake word that stops working should say so once and leave the session alone.
 */
export function listenForWake(options: {
  source: WakeSource
  settings?: WakeSettings
  onWake: () => void
  onError?: (message: string) => void
}): WakeListener {
  let paused = false
  let closed = false

  void (async () => {
    try {
      for await (const hit of detections(options.source.scores(), options.settings ?? DEFAULT_WAKE)) {
        if (closed) return
        // Checked here rather than by stopping the source: pausing has to be instant and
        // reversible, and tearing the recorder down and back up takes long enough that the
        // first word after "hey jarvis" would be missed.
        if (paused) continue
        options.onWake()
      }
    } catch (error) {
      if (!closed) options.onError?.(error instanceof Error ? error.message : String(error))
    }
  })()

  return {
    pause: () => {
      paused = true
    },
    resume: () => {
      paused = false
    },
    get paused() {
      return paused
    },
    close: () => {
      closed = true
      options.source.close()
    },
  }
}

/**
 * Streaming capture commands, best first, each writing raw signed 16-bit little-endian mono
 * PCM at 16 kHz to stdout.
 *
 * A separate list from `RECORDERS` in ui/voice.ts even though two of the binaries overlap:
 * that one captures a wav file and stops, this one is a tap that never closes, and the flags
 * have nothing in common. Sharing them would mean one list that does neither job plainly.
 */
export const STREAMS: readonly (readonly string[])[] = [
  ["arecord", "-q", "-f", "S16_LE", "-r", String(SAMPLE_RATE), "-c", "1", "-t", "raw", "-"],
  ["sox", "-d", "-q", "-t", "raw", "-r", String(SAMPLE_RATE), "-e", "signed", "-b", "16", "-c", "1", "-"],
  ["rec", "-q", "-t", "raw", "-r", String(SAMPLE_RATE), "-e", "signed", "-b", "16", "-c", "1", "-"],
  // prettier-ignore
  ["ffmpeg", "-loglevel", "quiet", "-f", "avfoundation", "-i", ":0", "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "-"],
  // prettier-ignore
  ["ffmpeg", "-loglevel", "quiet", "-f", "alsa", "-i", "default", "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "-"],
]

/** Which capture command to run, or `undefined` when nothing usable is installed. */
export function pickStream(has: (bin: string) => boolean, override?: string): readonly string[] | undefined {
  if (override?.trim()) return override.trim().split(/\s+/)
  return STREAMS.find((command) => has(command[0]!))
}

/**
 * A sliding window over a stream, emitting every `stride` items once `size` have arrived.
 *
 * Three stages of the detector need exactly this and disagree only on the numbers — mel frames
 * into the embedding model, embeddings into the classifier — so it is one tested thing rather
 * than three hand-rolled index loops, which is where this kind of code normally goes wrong.
 */
export class Window<T> {
  private readonly items: T[] = []
  private sinceEmit = 0

  constructor(
    readonly size: number,
    readonly stride: number,
  ) {}

  /** Adds items, returning a snapshot for each complete window they completed. */
  push(...items: T[]): T[][] {
    const windows: T[][] = []
    for (const item of items) {
      this.items.push(item)
      if (this.items.length > this.size) this.items.splice(0, this.items.length - this.size)
      this.sinceEmit += 1
      if (this.items.length === this.size && this.sinceEmit >= this.stride) {
        this.sinceEmit = 0
        windows.push([...this.items])
      }
    }
    return windows
  }

  /** Drops everything, so a resumed listener does not score across the gap. */
  reset(): void {
    this.items.length = 0
    this.sinceEmit = 0
  }
}

/**
 * 16-bit little-endian PCM as the float samples the melspectrogram model wants.
 *
 * openWakeWord's front end takes raw sample values in `[-32768, 32767]` as float32 — it does
 * the normalising itself — so this widens the type without scaling. Getting that wrong is
 * silent: the model runs, and simply never hears anything.
 */
export function pcmToFloat(bytes: Uint8Array, into?: Float32Array): Float32Array {
  const count = Math.floor(bytes.length / 2)
  const out = into ?? new Float32Array(count)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true)
  return out
}

/** One NDJSON line from the wake worker. */
export type WakeLine = { t: number; score: number } | { ready: true } | { error: string }

/**
 * Reads newline-delimited JSON off a stream. One object per chunk, so a partial line at the
 * end of a read is normal and has to be carried over.
 */
export async function* ndjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<WakeLine> {
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
            yield JSON.parse(line) as WakeLine
          } catch {
            // A half-written line, or a stray log on the wrong stream. Dropping it beats
            // killing the listener.
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
 * Spawns the wake worker and reads scores from its stdout.
 *
 * Its own process for the same reason the vision worker is: `onnxruntime-node` is a native
 * addon and the biggest unknown on arm64, so a crash costs a restartable child rather than
 * the terminal somebody was working in.
 */
export function onnxWakeSource(options: { phrase?: string; recorder?: string; runtime?: string; script?: string }): WakeSource {
  const script = options.script ?? new URL("./wake-worker.ts", import.meta.url).pathname
  const child = Bun.spawn(
    [
      options.runtime ?? "bun",
      script,
      `--phrase=${options.phrase ?? "hey_jarvis"}`,
      ...(options.recorder ? [`--recorder=${options.recorder}`] : []),
    ],
    { stdout: "pipe", stderr: "ignore" },
  )

  return {
    async *scores() {
      for await (const line of ndjson(child.stdout)) {
        if ("error" in line) throw new Error(`wake worker: ${line.error}`)
        if ("score" in line) yield line
      }
    },
    close() {
      child.kill()
    },
  }
}

/**
 * A scripted score timeline, so the gate, the listener and the hand-off into push-to-talk can
 * all be exercised on a laptop with no microphone and no model files — the same trick
 * `--source=script` plays for the drawing pipeline.
 */
export function scriptedWakeSource(samples: readonly number[], options: { paced?: boolean } = {}): WakeSource {
  let stop = false
  return {
    async *scores() {
      let t = 0
      for (const score of samples) {
        if (stop) return
        if (options.paced) await Bun.sleep(80)
        yield { t, score }
        t += 80
      }
    },
    close() {
      stop = true
    },
  }
}
