#!/usr/bin/env bun
/**
 * openWakeWord's detector, emitting one NDJSON score per 80 ms of audio on stdout.
 *
 * Runs as its own process so a native-addon crash costs a restartable child rather than the
 * terminal somebody was working in, and so the same file can be run under `node` if
 * `onnxruntime-node` misbehaves under Bun on arm64 — exactly the reasoning in
 * `src/pi/vision-worker.ts`, which this is the audio twin of.
 *
 * Audio comes from an external binary — `arecord` on a Pi, `sox` or `ffmpeg` elsewhere —
 * writing raw 16 kHz mono PCM to stdout. None of it is our code and all of it is already
 * installed on its platform.
 *
 * The chain has three stages, and the shapes are openWakeWord's, not ours:
 *
 *   480 + 1280 samples  →  melspectrogram  →  8 mel frames of 32 bins
 *   76 mel frames       →  embedding       →  one 96-value vector    (stride 8 frames)
 *   16 embeddings       →  classifier      →  one score in [0, 1]    (stride 1)
 *
 * Which works out at one score per chunk — every 80 ms — after about 1.9 seconds of warm-up,
 * because that is how much audio has to arrive before the first window of either stage is
 * full. Nothing is scored before then, which is worth knowing when a fresh listener seems deaf
 * for the first two seconds.
 */
import { CHUNK_SAMPLES, MEL_CONTEXT_SAMPLES, Window, pcmToFloat, pickStream } from "./wake.ts"
import { missingWakeModels, wakeModelPaths } from "./wake-models.ts"

type Args = { phrase: string; recorder?: string }

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=")
  return { phrase: get("phrase") || "hey_jarvis", recorder: get("recorder") }
}

const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
const die = (message: string): never => {
  emit({ error: message })
  process.exit(1)
}

/** The windows the two later stages slide, and the width of a mel frame. */
const MEL_BINS = 32
const EMBED_FRAMES = 76
const EMBED_STRIDE = 8
const CLASSIFIER_EMBEDDINGS = 16

/**
 * Reads exactly `size` bytes at a time off a stream, carrying the remainder.
 *
 * A capture binary writes whatever the sound card handed it, which is never aligned to our
 * chunk size. Scoring a short chunk shifts every mel frame after it.
 */
async function* fixedChunks(stream: ReadableStream<Uint8Array>, size: number): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  let buffer = new Uint8Array(0)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      const merged = new Uint8Array(buffer.length + value.length)
      merged.set(buffer)
      merged.set(value, buffer.length)
      buffer = merged
      let offset = 0
      while (buffer.length - offset >= size) {
        yield buffer.subarray(offset, offset + size)
        offset += size
      }
      buffer = buffer.slice(offset)
    }
  } finally {
    reader.releaseLock()
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  let ort: typeof import("onnxruntime-node")
  try {
    ort = await import("onnxruntime-node")
  } catch {
    return void die(
      "onnxruntime-node is not installed — it is a ~100MB native addon only the wake word and " +
        "the Pi camera use, so it is not a dependency. Install it with `bun add onnxruntime-node`.",
    )
  }

  const missing = missingWakeModels(args.phrase)
  if (missing.length > 0) {
    return void die(`missing wake models: ${missing.join(", ")} — run \`jarvis wake models\` to fetch them`)
  }
  const models = wakeModelPaths(args.phrase)

  const command = pickStream((bin) => Bun.which(bin) !== null, args.recorder)
  if (!command) {
    return void die("no audio capture binary on PATH — install alsa-utils (arecord), sox or ffmpeg")
  }

  const mel = await ort.InferenceSession.create(models.melspectrogram)
  const embed = await ort.InferenceSession.create(models.embedding)
  const classifier = await ort.InferenceSession.create(models.phrase)

  const melWindow = new Window<Float32Array>(EMBED_FRAMES, EMBED_STRIDE)
  const embedWindow = new Window<Float32Array>(CLASSIFIER_EMBEDDINGS, 1)
  // The context prefix and the chunk, in one buffer that is reused rather than reallocated
  // eighty times a second. Starts as silence, which is what padding the first chunk means.
  const fed = new Float32Array(MEL_CONTEXT_SAMPLES + CHUNK_SAMPLES)

  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "ignore" })
  emit({ ready: true })

  const started = performance.now()
  for await (const raw of fixedChunks(child.stdout, CHUNK_SAMPLES * 2)) {
    // Slide the tail of the last window to the front, then decode the new chunk after it.
    fed.copyWithin(0, CHUNK_SAMPLES)
    pcmToFloat(raw, fed.subarray(MEL_CONTEXT_SAMPLES))
    const t = Math.round(performance.now() - started)

    const melOut = await mel.run({
      [mel.inputNames[0]!]: new ort.Tensor("float32", fed, [1, fed.length]),
    })
    // openWakeWord applies this scaling between the front end and the embedding model. It is
    // not cosmetic: the embedding model was trained on scaled input and returns noise without
    // it, which looks exactly like a microphone that is not picking anything up.
    const melData = melOut[mel.outputNames[0]!]!.data as Float32Array
    // Derived, never assumed. The frame count is a function of the input length and this
    // model's internal hop, and hardcoding the wrong one reads past the end of the tensor
    // into zeros — which scores like silence and gives nothing to debug.
    const frameCount = Math.floor(melData.length / MEL_BINS)
    const frames: Float32Array[] = []
    for (let i = 0; i < frameCount; i++) {
      const frame = new Float32Array(MEL_BINS)
      for (let bin = 0; bin < MEL_BINS; bin++) frame[bin] = (melData[i * MEL_BINS + bin] ?? 0) / 10 + 2
      frames.push(frame)
    }

    for (const window of melWindow.push(...frames)) {
      const flat = new Float32Array(EMBED_FRAMES * MEL_BINS)
      window.forEach((frame, i) => flat.set(frame, i * MEL_BINS))
      const embedOut = await embed.run({
        [embed.inputNames[0]!]: new ort.Tensor("float32", flat, [1, EMBED_FRAMES, MEL_BINS, 1]),
      })
      const vector = Float32Array.from(embedOut[embed.outputNames[0]!]!.data as Float32Array)

      for (const stack of embedWindow.push(vector)) {
        const input = new Float32Array(CLASSIFIER_EMBEDDINGS * vector.length)
        stack.forEach((one, i) => input.set(one, i * vector.length))
        const out = await classifier.run({
          [classifier.inputNames[0]!]: new ort.Tensor("float32", input, [
            1,
            CLASSIFIER_EMBEDDINGS,
            vector.length,
          ]),
        })
        const score = (out[classifier.outputNames[0]!]!.data as Float32Array)[0] ?? 0
        emit({ t, score })
      }
    }
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)))
}
