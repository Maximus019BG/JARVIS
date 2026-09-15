import { existsSync, mkdirSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { dataDir } from "../config/paths.ts"

export const wakeModelDir = join(dataDir, "models", "wake")

/**
 * openWakeWord's release assets. Its detector is three models in a chain rather than one:
 * a melspectrogram front end, a shared speech-embedding model, and a small per-phrase
 * classifier on top. Only the last one is specific to a wake word, which is what makes
 * training your own cheap — the two expensive stages are already done.
 *
 * Pinned to a release tag rather than `latest`: a silently newer embedding model would
 * change what every classifier sees, and the failure mode is "it stopped hearing me".
 */
const RELEASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1"

export type WakeModel = { file: string; url: string }

/** The two stages every wake word shares. */
export const SHARED_MODELS: Record<"melspectrogram" | "embedding", WakeModel> = {
  melspectrogram: { file: "melspectrogram.onnx", url: `${RELEASE}/melspectrogram.onnx` },
  embedding: { file: "embedding_model.onnx", url: `${RELEASE}/embedding_model.onnx` },
}

/**
 * Pretrained phrases. `hey_jarvis` is the default for reasons that should be obvious, and it
 * is a real openWakeWord model rather than something we had to train.
 */
export const PHRASES: Record<string, WakeModel> = {
  hey_jarvis: { file: "hey_jarvis_v0.1.onnx", url: `${RELEASE}/hey_jarvis_v0.1.onnx` },
  alexa: { file: "alexa_v0.1.onnx", url: `${RELEASE}/alexa_v0.1.onnx` },
  hey_mycroft: { file: "hey_mycroft_v0.1.onnx", url: `${RELEASE}/hey_mycroft_v0.1.onnx` },
}

export const DEFAULT_PHRASE = "hey_jarvis"

export type WakeModelPaths = { melspectrogram: string; embedding: string; phrase: string }

/**
 * Where the three models live for a given phrase.
 *
 * A phrase that is not in `PHRASES` is treated as a path, so a model trained on your own
 * voice is a config change rather than a fork. That is the whole point of openWakeWord's
 * split: the classifier is ~100 KB and trains in an afternoon.
 */
export function wakeModelPaths(phrase: string = DEFAULT_PHRASE): WakeModelPaths {
  const known = PHRASES[phrase]
  return {
    melspectrogram: join(wakeModelDir, SHARED_MODELS.melspectrogram.file),
    embedding: join(wakeModelDir, SHARED_MODELS.embedding.file),
    phrase: known ? join(wakeModelDir, known.file) : isAbsolute(phrase) ? phrase : join(wakeModelDir, phrase),
  }
}

/** Which of the three are not on disk yet, by the label a message should use. */
export function missingWakeModels(phrase: string = DEFAULT_PHRASE): string[] {
  const paths = wakeModelPaths(phrase)
  return Object.entries(paths)
    .filter(([, path]) => !existsSync(path))
    .map(([name]) => name)
}

/**
 * Downloads the shared pair plus one phrase. Written to `.part` and renamed on success, so
 * an interrupted download can never leave a truncated model to fail deep inside the ONNX
 * runtime with an unhelpful error — the same rule as the vision models.
 */
export async function fetchWakeModels(
  phrase: string = DEFAULT_PHRASE,
  log: (message: string) => void = () => {},
): Promise<{ fetched: string[]; errors: string[] }> {
  mkdirSync(wakeModelDir, { recursive: true })
  const fetched: string[] = []
  const errors: string[] = []

  const wanted = [...Object.values(SHARED_MODELS)]
  const known = PHRASES[phrase]
  if (known) wanted.push(known)
  else if (!existsSync(wakeModelPaths(phrase).phrase)) {
    errors.push(
      `"${phrase}" is not a pretrained phrase and no file exists at that path — ` +
        `pick one of ${Object.keys(PHRASES).join(", ")}, or train one with openWakeWord and point at the .onnx`,
    )
  }

  for (const { file, url } of wanted) {
    const target = join(wakeModelDir, file)
    if (existsSync(target)) continue
    const partial = `${target}.part`
    log(`fetching ${file}…`)
    try {
      const response = await fetch(url)
      if (!response.ok) {
        errors.push(`${file}: ${response.status} ${response.statusText}`)
        continue
      }
      await Bun.write(partial, response)
      if (Bun.file(partial).size < 1024) {
        errors.push(`${file}: downloaded file is implausibly small — check the URL`)
        continue
      }
      await Bun.$`mv ${partial} ${target}`.quiet()
      fetched.push(file)
      log(`  → ${target}`)
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { fetched, errors }
}
