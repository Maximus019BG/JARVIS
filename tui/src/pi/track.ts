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
  cropToTensor,
  decodeDetections,
  generateAnchors,
  landmarksToCamera,
  nms,
  PALM_ANCHORS,
  palmCentre,
  pushTrail,
  roiFromPalm,
  trailToTensor,
  type Roi,
  type TrailPoint,
} from "./detect.ts"
import { handSpan, type Hand, type Label, type Landmark } from "./gestures.ts"

type OrtTensor = { data: unknown; dims: readonly number[] }
type OrtSession = {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  /** onnxruntime 1.20+. Absent on older runtimes, which then get NCHW. */
  readonly inputMetadata?: readonly { readonly name: string; readonly shape?: readonly (number | string)[] }[]
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}
type SessionOptions = { intraOpNumThreads?: number; interOpNumThreads?: number; graphOptimizationLevel?: "all" }
export type Ort = {
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => OrtTensor
  InferenceSession: { create(path: string, options?: SessionOptions): Promise<OrtSession> }
}

export type Camera = { width: number; height: number }
export type StepResult = { hands: Hand[]; roi?: Roi; trail?: TrailPoint[]; motion?: Label }
export type Tracker = {
  step(
    rgb: Uint8Array,
    camera: Camera,
    options: { roi?: Roi; detect: boolean; trail?: readonly TrailPoint[] },
  ): Promise<StepResult>
}

/** `hand_gesture.json`, written next to the model by the notebook. */
export type GestureLabels = { gesture: string[]; motion: string[]; window: number }
export type Classifier = {
  readonly window: number
  classify(landmarks: readonly Landmark[], trail: readonly TrailPoint[]): Promise<{ gesture: Label; motion: Label }>
}

const LANDMARK_INPUT = 224

/**
 * Which way round a model wants its pixels, from its own input shape: `[1, H, W, 3]` is a
 * TFLite conversion left channels-last, anything else is the usual channels-first.
 */
const layoutOf = (session: OrtSession): "nchw" | "nhwc" => (session.inputMetadata?.[0]?.shape?.[3] === 3 ? "nhwc" : "nchw")
const inputDims = (layout: "nchw" | "nhwc", size: number) => (layout === "nchw" ? [1, 3, size, size] : [1, size, size, 3])

const top = (probs: ArrayLike<number>, labels: readonly string[]): Label => {
  let best = 0
  for (let i = 1; i < labels.length; i++) if ((probs[i] ?? 0) > (probs[best] ?? 0)) best = i
  return { name: labels[best]!, score: probs[best] ?? 0 }
}

/**
 * The learned gesture model: 21 landmarks and a motion trail in, a pose and a motion out.
 * About 10K weights, so a thread pool would cost more than the arithmetic: one thread, and
 * normalisation lives inside the graph, so raw camera pixels go straight in.
 */
export async function createClassifier(ort: Ort, path: string, labels: GestureLabels): Promise<Classifier> {
  const session = await ort.InferenceSession.create(path, {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    graphOptimizationLevel: "all",
  })
  const points = new Float32Array(21 * 2)
  const trailBuffer = new Float32Array(labels.window * 3)
  let checked = false

  return {
    window: labels.window,
    async classify(landmarks, trail) {
      for (let i = 0; i < 21; i++) {
        points[i * 2] = landmarks[i]?.x ?? 0
        points[i * 2 + 1] = landmarks[i]?.y ?? 0
      }
      const output = await session.run({
        landmarks: new ort.Tensor("float32", points, [1, 21, 2]),
        trail: new ort.Tensor("float32", trailToTensor(trail, labels.window, trailBuffer), [1, labels.window, 3]),
      })
      const gesture = output.gesture!.data as Float32Array
      const motion = output.motion!.data as Float32Array
      // Same reasoning as the anchor check: a labels file from a different training run
      // would name every gesture wrongly without anything failing.
      if (!checked) {
        if (gesture.length !== labels.gesture.length || motion.length !== labels.motion.length) {
          throw new Error(
            `gesture model outputs ${gesture.length}+${motion.length} classes but hand_gesture.json lists ` +
              `${labels.gesture.length}+${labels.motion.length} — export both files from the same notebook run`,
          )
        }
        checked = true
      }
      return { gesture: top(gesture, labels.gesture), motion: top(motion, labels.motion) }
    },
  }
}

export async function createTracker(
  ort: Ort,
  paths: { palm: string; landmark: string },
  gesture?: { path: string; labels: GestureLabels },
): Promise<Tracker> {
  const palm = await ort.InferenceSession.create(paths.palm)
  const landmark = await ort.InferenceSession.create(paths.landmark)
  const classifier = gesture ? await createClassifier(ort, gesture.path, gesture.labels) : undefined
  const anchors = generateAnchors(PALM_ANCHORS)
  const PALM_INPUT = PALM_ANCHORS.inputSize
  const palmBuffer = new Float32Array(3 * PALM_INPUT * PALM_INPUT)
  const landmarkBuffer = new Float32Array(3 * LANDMARK_INPUT * LANDMARK_INPUT)
  const palmLayout = layoutOf(palm)
  const landmarkLayout = layoutOf(landmark)
  let checked = false

  return {
    async step(rgb, camera, options) {
      let roi = options.roi
      if (options.detect || !roi) {
        // Letterboxed into a square, as MediaPipe feeds its detector: a 4:3 frame stretched
        // to 192×192 squashes every palm by a quarter.
        const side = Math.max(camera.width, camera.height)
        const square = { x: (camera.width - side) / 2, y: (camera.height - side) / 2, w: side, h: side }
        cropToTensor(rgb, camera, square, PALM_INPUT, palmBuffer, palmLayout)
        const output = await palm.run({
          [palm.inputNames[0]!]: new ort.Tensor("float32", palmBuffer, inputDims(palmLayout, PALM_INPUT)),
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
        const region = { x: square.x, y: square.y, width: side, height: side }
        // Not clamped to the frame: a hand close to the camera needs a crop bigger than the
        // picture, and squeezing it in cuts fingers off (a palm then reads as "three").
        // cropToTensor pads the outside with black, as MediaPipe does.
        roi = found[0] ? roiFromPalm(found[0], region) : undefined
      }
      if (!roi) return { hands: [] }

      cropToTensor(rgb, camera, roi, LANDMARK_INPUT, landmarkBuffer, landmarkLayout)
      const output = await landmark.run({
        [landmark.inputNames[0]!]: new ort.Tensor("float32", landmarkBuffer, inputDims(landmarkLayout, LANDMARK_INPUT)),
      })
      // The landmark model emits a 63-value tensor plus a presence score; pick them by size
      // rather than by name, since the exported names differ between conversions.
      const outputs = landmark.outputNames.map((name) => output[name]!)
      const coords = outputs.find((tensor) => (tensor.data as ArrayLike<number>).length >= 63)
      const presence = outputs.find((tensor) => (tensor.data as ArrayLike<number>).length === 1)
      if (!coords) throw new Error("the landmark model produced no coordinate tensor")

      const score = presence ? Math.min(1, Math.max(0, (presence.data as Float32Array)[0] ?? 1)) : 1
      // A confident hand keeps its ROI for the next frame; a lost one forces a re-detect.
      // A lost hand also drops the trail, so a reappearing hand never reads as a swipe.
      if (score < 0.5) return { hands: [] }
      const landmarks = landmarksToCamera(coords.data as Float32Array, roi, { inputSize: LANDMARK_INPUT })
      const hand: Hand = { score, landmarks }
      if (!classifier) return { hands: [hand], roi }

      const trail = pushTrail(options.trail ?? [], [...palmCentre(landmarks), handSpan(hand)], classifier.window)
      const { gesture, motion } = await classifier.classify(landmarks, trail)
      return { hands: [{ ...hand, gesture }], roi, trail, motion }
    },
  }
}
