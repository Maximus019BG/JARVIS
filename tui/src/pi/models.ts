import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { dataDir } from "../config/paths.ts"

export const modelDir = join(dataDir, "models")

/**
 * The two ONNX models the vision worker and the web API's hand route need. Not vendored into
 * the repo: together they are a few megabytes of binary, only ever read, never edited — a
 * fetch-on-demand keeps the repository and the compiled binary small.
 *
 * MediaPipe's palm detector (192px, 2016 anchors) and hand landmarks (224px), as converted by
 * OpenCV Zoo (Apache-2.0). They are channels-last; `track.ts` reads that off the model.
 */
export const MODELS = {
  palm: {
    file: "palm_detection.onnx",
    url: "https://huggingface.co/opencv/palm_detection_mediapipe/resolve/main/palm_detection_mediapipe_2023feb.onnx",
  },
  landmark: {
    file: "hand_landmark.onnx",
    url: "https://huggingface.co/opencv/handpose_estimation_mediapipe/resolve/main/handpose_estimation_mediapipe_2023feb.onnx",
  },
} as const

export type ModelName = keyof typeof MODELS

/**
 * The learned gesture classifier and its labels. Optional, and not in `MODELS`: it is ours,
 * trained in `models/hand_gestgures.ipynb`, so there is nothing to download — copy the two
 * files here (the notebook's last cell does) and the worker picks them up.
 */
export const gesturePaths = {
  model: join(modelDir, "hand_gesture.onnx"),
  labels: join(modelDir, "hand_gesture.json"),
}

export function modelPaths(): Record<ModelName, string> {
  return {
    palm: join(modelDir, MODELS.palm.file),
    landmark: join(modelDir, MODELS.landmark.file),
  }
}

export function missingModels(): ModelName[] {
  const paths = modelPaths()
  return (Object.keys(MODELS) as ModelName[]).filter((name) => !existsSync(paths[name]))
}

/**
 * Downloads whatever is missing. Written to a `.part` file and renamed on success, so an
 * interrupted download can never leave a truncated model that fails deep inside the ONNX
 * runtime with an unhelpful error.
 */
export async function fetchModels(
  log: (message: string) => void = () => {},
): Promise<{ fetched: ModelName[]; errors: string[] }> {
  mkdirSync(modelDir, { recursive: true })
  const fetched: ModelName[] = []
  const errors: string[] = []

  for (const name of missingModels()) {
    const { file, url } = MODELS[name]
    const target = join(modelDir, file)
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
      fetched.push(name)
      log(`  → ${target}`)
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { fetched, errors }
}
