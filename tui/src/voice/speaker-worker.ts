#!/usr/bin/env bun
/**
 * Speaker embeddings, one request at a time over NDJSON on stdin and stdout.
 *
 * Request/response rather than the one-way stream the wake worker emits, because this answers
 * a question instead of watching for one — and long-lived rather than spawned per utterance,
 * because loading a hundred megabytes of ONNX takes a second or two and nobody should wait
 * for that between saying something and being heard.
 *
 * Its own process for the reason every ONNX path here is: `onnxruntime-node` is a native addon
 * and the biggest unknown on arm64, so a crash costs a restartable child rather than the
 * terminal somebody was working in.
 *
 *   float32 waveform in [-1, 1], [1, samples]  →  embeddings, [1, 512]
 */
import { speakerModelPath } from "./speaker-models.ts"

type Request = { id: number; pcm: string }

const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
const die = (message: string): never => {
  emit({ error: message })
  process.exit(1)
}

function parseArgs(argv: string[]): { model?: string } {
  return { model: argv.find((arg) => arg.startsWith("--model="))?.split("=").slice(1).join("=") }
}

/**
 * Base64 PCM as the amplitude the model expects.
 *
 * The same conversion as `pcmToUnit`, repeated rather than imported so this file stays a leaf
 * the worker can run under plain `node` — and the factor of 32768 is the one number in it that
 * matters, since getting it wrong scores 0.974 against the right answer instead of failing.
 */
function decode(base64: string): Float32Array {
  const bytes = Buffer.from(base64, "base64")
  const count = Math.floor(bytes.length / 2)
  const out = new Float32Array(count)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  let ort: typeof import("onnxruntime-node")
  try {
    ort = await import("onnxruntime-node")
  } catch {
    return void die(
      "onnxruntime-node is not installed — it is a ~100MB native addon only the voice and camera " +
        "paths use, so it is not a dependency. Install it with `bun add onnxruntime-node`.",
    )
  }

  const path = speakerModelPath(args.model)
  if (!(await Bun.file(path).exists())) {
    return void die(`missing speaker model at ${path} — run \`jarvis voice models\` to fetch it`)
  }

  const session = await ort.InferenceSession.create(path)
  // Named rather than taken by position: this export emits `logits` too, and they are the same
  // width as the embeddings, so picking the wrong one produces a plausible vector that scores
  // like noise.
  const output = session.outputNames.includes("embeddings") ? "embeddings" : session.outputNames[0]!
  emit({ ready: true })

  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of process.stdin) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true })
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
      if (!line) continue
      let request: Request
      try {
        request = JSON.parse(line) as Request
      } catch {
        continue
      }
      try {
        const samples = decode(request.pcm)
        const result = await session.run({
          [session.inputNames[0]!]: new ort.Tensor("float32", samples, [1, samples.length]),
        })
        emit({ id: request.id, embedding: Array.from(result[output]!.data as Float32Array) })
      } catch (error) {
        emit({ id: request.id, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)))
}
