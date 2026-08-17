import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { dataDir } from "../config/paths.ts"

export const modelDir = join(dataDir, "models")

/**
 * The two ONNX models the vision worker needs. Not vendored into the repo: together they
 * are a few megabytes of binary that only the Pi path uses, and only ever read, never
 * edited — a fetch-on-demand keeps the repository and the compiled binary small.
 */
export const MODELS = {
  palm: {
    file: "palm_detection.onnx",
    url: "https://huggingface.co/vladmandic/hand-detection/resolve/main/palm_detection.onnx",
  },
  landmark: {
    file: "hand_landmark.onnx",
    url: "https://huggingface.co/vladmandic/hand-detection/resolve/main/hand_landmark.onnx",
  },
} as const

export type ModelName = keyof typeof MODELS

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
