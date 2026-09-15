import { existsSync, mkdirSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { dataDir } from "../config/paths.ts"

export const speakerModelDir = join(dataDir, "models", "speaker")

/**
 * WavLM base+ with an x-vector head, as exported for onnxruntime.
 *
 * Chosen over the usual speaker embedders — ECAPA-TDNN, CAM++, WeSpeaker — for one practical
 * reason: it takes a **raw waveform**. Every one of the others wants 80-dimensional filterbank
 * features, which would mean writing a mel front end in TypeScript and getting the window,
 * the hop and the filter shapes bit-exact against a reference nobody here can run.
 *
 * The quantized export, at ~100 MB against ~400 MB, because this runs on a Pi and the
 * difference in what it can tell apart is not worth four times the download.
 */
export const SPEAKER_MODEL = {
  file: "wavlm-base-plus-sv.onnx",
  url: "https://huggingface.co/Xenova/wavlm-base-plus-sv/resolve/main/onnx/model_quantized.onnx",
} as const

/** The embedding width this model produces. Asserted at runtime, never assumed. */
export const EMBEDDING_DIMS = 512

/** Where the model lives, or the path itself when one was named in the config. */
export function speakerModelPath(override?: string): string {
  if (!override) return join(speakerModelDir, SPEAKER_MODEL.file)
  return isAbsolute(override) ? override : join(speakerModelDir, override)
}

export const speakerModelMissing = (override?: string): boolean => !existsSync(speakerModelPath(override))

/**
 * Downloads the model if it is not already there. Written to `.part` and renamed on success,
 * so an interrupted download cannot leave a truncated file to fail deep inside the ONNX
 * runtime — the same rule as the vision and wake models.
 */
export async function fetchSpeakerModel(
  log: (message: string) => void = () => {},
): Promise<{ fetched: boolean; error?: string }> {
  const target = speakerModelPath()
  if (existsSync(target)) return { fetched: false }
  mkdirSync(speakerModelDir, { recursive: true })
  const partial = `${target}.part`
  log(`fetching ${SPEAKER_MODEL.file} (~100 MB)…`)
  try {
    const response = await fetch(SPEAKER_MODEL.url)
    if (!response.ok) return { fetched: false, error: `${response.status} ${response.statusText}` }
    await Bun.write(partial, response)
    // Ten megabytes is far below the real size and far above anything an error page could be.
    if (Bun.file(partial).size < 10_000_000) {
      return { fetched: false, error: "downloaded file is implausibly small — check the URL" }
    }
    await Bun.$`mv ${partial} ${target}`.quiet()
    log(`  → ${target}`)
    return { fetched: true }
  } catch (error) {
    return { fetched: false, error: error instanceof Error ? error.message : String(error) }
  }
}
