/**
 * One frame in, hands out: palm detection when asked, then hand landmarks inside the ROI.
 *
 * Shared by the local vision worker and the web API's hand route, so the Pi and the hosted
 * model can never disagree about how a frame becomes landmarks. Runtime-neutral on purpose
 * — no Bun, no Node imports — because Next compiles this file too.
 *
 * `ort` is handed in rather than imported: the TUI keeps `onnxruntime-node` optional and
 * loads it dynamically, and the web app has the real package. The structural type below is
 * the whole surface this file calls.
 */
import {
  assertAnchorCount,
  clampRoi,
  cropToTensor,
  decodeDetections,
  generateAnchors,
  landmarksToCamera,
  nms,
  PALM_ANCHORS,
  roiFromPalm,
  type Roi,
} from "./detect.ts"
import type { Hand } from "./gestures.ts"

type OrtTensor = { data: unknown; dims: readonly number[] }
type OrtSession = {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}
export type Ort = {
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => OrtTensor
  InferenceSession: { create(path: string): Promise<OrtSession> }
}

export type Camera = { width: number; height: number }
export type StepResult = { hands: Hand[]; roi?: Roi }
export type Tracker = {
  step(rgb: Uint8Array, camera: Camera, options: { roi?: Roi; detect: boolean }): Promise<StepResult>
}

const LANDMARK_INPUT = 224

export async function createTracker(ort: Ort, paths: { palm: string; landmark: string }): Promise<Tracker> {
  const palm = await ort.InferenceSession.create(paths.palm)
  const landmark = await ort.InferenceSession.create(paths.landmark)
  const anchors = generateAnchors(PALM_ANCHORS)
  const PALM_INPUT = PALM_ANCHORS.inputSize
  const palmBuffer = new Float32Array(3 * PALM_INPUT * PALM_INPUT)
  const landmarkBuffer = new Float32Array(3 * LANDMARK_INPUT * LANDMARK_INPUT)
  let checked = false

  return {
    async step(rgb, camera, options) {
      let roi = options.roi
      if (options.detect || !roi) {
        cropToTensor(rgb, camera, { x: 0, y: 0, w: camera.width, h: camera.height }, PALM_INPUT, palmBuffer)
        const output = await palm.run({
          [palm.inputNames[0]!]: new ort.Tensor("float32", palmBuffer, [1, 3, PALM_INPUT, PALM_INPUT]),
        })
        const tensors = palm.outputNames.map((name) => output[name]!)
        // Scores are the single-channel output; regressors are the wider one.
        const [scoresTensor, boxesTensor] =
          (tensors[0]!.dims.at(-1) ?? 1) === 1 ? [tensors[0]!, tensors[1]!] : [tensors[1]!, tensors[0]!]
        const scores = scoresTensor.data as Float32Array
        if (!checked) {
          assertAnchorCount(scores.length, anchors)
          checked = true
        }
        const found = nms(
          decodeDetections(boxesTensor.data as Float32Array, scores, anchors, { inputSize: PALM_INPUT, threshold: 0.5 }),
          0.3,
          2,
        )
        roi = found[0] ? clampRoi(roiFromPalm(found[0], camera), camera) : undefined
      }
      if (!roi) return { hands: [] }

      cropToTensor(rgb, camera, roi, LANDMARK_INPUT, landmarkBuffer)
      const output = await landmark.run({
        [landmark.inputNames[0]!]: new ort.Tensor("float32", landmarkBuffer, [1, 3, LANDMARK_INPUT, LANDMARK_INPUT]),
      })
      // The landmark model emits a 63-value tensor plus a presence score; pick them by size
      // rather than by name, since the exported names differ between conversions.
      const outputs = landmark.outputNames.map((name) => output[name]!)
      const coords = outputs.find((tensor) => (tensor.data as ArrayLike<number>).length >= 63)
      const presence = outputs.find((tensor) => (tensor.data as ArrayLike<number>).length === 1)
      if (!coords) throw new Error("the landmark model produced no coordinate tensor")

      const score = presence ? Math.min(1, Math.max(0, (presence.data as Float32Array)[0] ?? 1)) : 1
      // A confident hand keeps its ROI for the next frame; a lost one forces a re-detect.
      if (score < 0.5) return { hands: [] }
      const landmarks = landmarksToCamera(coords.data as Float32Array, roi, { inputSize: LANDMARK_INPUT })
      return { hands: [{ score, landmarks }], roi }
    },
  }
}
