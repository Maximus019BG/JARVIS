/**
 * Pure tensor post-processing for the hand pipeline.
 *
 * Split out from the worker on purpose: the spawning, the ONNX session and the camera are
 * all hardware, but anchor decoding, non-maximum suppression and — most importantly — the
 * mapping from crop coordinates back to camera coordinates are plain arithmetic. That last
 * one is worth testing hard, because when it is subtly wrong nothing crashes; the drawing
 * just lands in the wrong place, which is the most expensive kind of bug to chase on a
 * projector.
 */

export type Box = { x: number; y: number; w: number; h: number; score: number }

export type AnchorConfig = {
  inputSize: number
  /** Feature-map strides, e.g. [8, 16, 16, 16] for MediaPipe's palm detector. */
  strides: readonly number[]
  /** Anchors per feature-map cell, per stride. */
  perCell: readonly number[]
}

export type Anchor = { cx: number; cy: number }

/**
 * MediaPipe's 192×192 palm detector (lite and full share this layout): 24²×2 + 12²×6 =
 * 2016 anchors. The count is the thing to check against a model — get it wrong and every
 * box decodes against the wrong anchor centre, which misplaces hands without erroring.
 */
export const PALM_ANCHORS: AnchorConfig = {
  inputSize: 192,
  strides: [8, 16],
  perCell: [2, 6],
}

/** The older 128×128 detector: 16²×2 + 8²×6 = 896 anchors. */
export const PALM_ANCHORS_128: AnchorConfig = {
  inputSize: 128,
  strides: [8, 16],
  perCell: [2, 6],
}

/**
 * SSD anchor centres in normalised [0,1] coordinates. Only centres are needed: the palm
 * model regresses absolute width and height, so anchor sizes never enter the arithmetic.
 */
export function generateAnchors(config: AnchorConfig): Anchor[] {
  const anchors: Anchor[] = []
  config.strides.forEach((stride, index) => {
    const size = Math.ceil(config.inputSize / stride)
    const count = config.perCell[index] ?? 1
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        for (let k = 0; k < count; k++) {
          anchors.push({ cx: (x + 0.5) / size, cy: (y + 0.5) / size })
        }
      }
    }
  })
  return anchors
}

export const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

/**
 * Checks a loaded model's score-tensor length against the anchor config, once at startup.
 *
 * Without this a model variant with a different anchor layout decodes silently against the
 * wrong centres: no exception, no obviously bad output, just hands reported in the wrong
 * place. Far better to refuse to start.
 */
export function assertAnchorCount(scoreLength: number, anchors: readonly Anchor[]): void {
  if (scoreLength !== anchors.length) {
    throw new Error(
      `palm model outputs ${scoreLength} scores but the anchor config generates ${anchors.length} — ` +
        `wrong model variant or wrong strides/perCell`,
    )
  }
}

/**
 * Turns raw regressor and score tensors into boxes in normalised coordinates.
 *
 * `regressors` is [N, stride] with dx, dy, w, h first; `scores` is [N]. Both are clipped
 * before the sigmoid because a large negative logit overflows `Math.exp` to Infinity and
 * yields NaN rather than the 0 it should.
 */
export function decodeDetections(
  regressors: ArrayLike<number>,
  scores: ArrayLike<number>,
  anchors: readonly Anchor[],
  options: { inputSize: number; threshold: number; stride?: number },
): Box[] {
  const stride = options.stride ?? 18
  const out: Box[] = []
  for (let i = 0; i < anchors.length; i++) {
    const raw = scores[i]
    if (raw === undefined) break
    const score = sigmoid(Math.max(-100, Math.min(100, raw)))
    if (score < options.threshold) continue

    const anchor = anchors[i]!
    const base = i * stride
    const dx = (regressors[base] ?? 0) / options.inputSize
    const dy = (regressors[base + 1] ?? 0) / options.inputSize
    const w = (regressors[base + 2] ?? 0) / options.inputSize
    const h = (regressors[base + 3] ?? 0) / options.inputSize
    if (!(w > 0) || !(h > 0)) continue

    out.push({ x: anchor.cx + dx - w / 2, y: anchor.cy + dy - h / 2, w, h, score })
  }
  return out
}

const area = (box: Box) => Math.max(0, box.w) * Math.max(0, box.h)

export function iou(a: Box, b: Box): number {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  const overlap = Math.max(0, right - x) * Math.max(0, bottom - y)
  const union = area(a) + area(b) - overlap
  return union > 0 ? overlap / union : 0
}

/** Greedy non-maximum suppression, highest score first. */
export function nms(boxes: readonly Box[], threshold = 0.3, limit = 4): Box[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const kept: Box[] = []
  for (const box of sorted) {
    if (kept.length >= limit) break
    if (kept.every((other) => iou(box, other) < threshold)) kept.push(box)
  }
  return kept
}

export type Roi = { x: number; y: number; w: number; h: number }

/**
 * Expands a palm box into the square region the landmark model expects.
 *
 * The palm detector only sees the palm, so a crop of its box cuts the fingers off and the
 * landmark model then invents them. MediaPipe's own constants — grow by 2.6× and shift up
 * by 0.5 box heights — cover the whole hand. Square because a non-square crop stretched to
 * the model's square input skews every landmark.
 */
export function roiFromPalm(
  box: Box,
  camera: { width: number; height: number },
  options: { scale?: number; shiftY?: number } = {},
): Roi {
  const scale = options.scale ?? 2.6
  const shiftY = options.shiftY ?? -0.5

  const cx = (box.x + box.w / 2) * camera.width
  const cy = (box.y + box.h / 2 + shiftY * box.h) * camera.height
  const side = Math.max(box.w * camera.width, box.h * camera.height) * scale

  return { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
}

/** Clamps an ROI to the frame while keeping it square, so the aspect never changes. */
export function clampRoi(roi: Roi, camera: { width: number; height: number }): Roi {
  const side = Math.min(roi.w, camera.width, camera.height)
  return {
    x: Math.max(0, Math.min(camera.width - side, roi.x)),
    y: Math.max(0, Math.min(camera.height - side, roi.y)),
    w: side,
    h: side,
  }
}

/**
 * Maps the landmark model's output back into camera pixels.
 *
 * The model emits 21 triples in its own input space (0..inputSize), which is the ROI
 * scaled to a square. Getting this back out means undoing that scale and re-adding the
 * ROI's offset — miss the offset and every stroke is displaced by wherever the hand
 * happened to be when it was detected.
 */
export function landmarksToCamera(
  raw: ArrayLike<number>,
  roi: Roi,
  options: { inputSize: number; count?: number; stride?: number },
): { x: number; y: number; z?: number }[] {
  const count = options.count ?? 21
  const stride = options.stride ?? 3
  const scale = roi.w / options.inputSize
  const out: { x: number; y: number; z?: number }[] = []
  for (let i = 0; i < count; i++) {
    const base = i * stride
    out.push({
      x: roi.x + (raw[base] ?? 0) * scale,
      y: roi.y + (raw[base + 1] ?? 0) * scale,
      z: stride > 2 ? raw[base + 2] : undefined,
    })
  }
  return out
}

/**
 * Nearest-neighbour crop-and-resize from a packed RGB frame into the model's square input,
 * written straight into a Float32 NCHW tensor.
 *
 * Nearest neighbour rather than bilinear because the landmark model is trained on
 * low-resolution crops and is entirely insensitive to the difference, while bilinear costs
 * four samples per pixel — on a Pi that is the difference between keeping up and not.
 * ponytail: revisit if landmark jitter ever traces back to aliasing here.
 */
export function cropToTensor(
  frame: Uint8Array,
  camera: { width: number; height: number },
  roi: Roi,
  inputSize: number,
  out = new Float32Array(3 * inputSize * inputSize),
): Float32Array {
  const plane = inputSize * inputSize
  for (let y = 0; y < inputSize; y++) {
    const sourceY = Math.min(camera.height - 1, Math.max(0, Math.round(roi.y + (y / inputSize) * roi.h)))
    for (let x = 0; x < inputSize; x++) {
      const sourceX = Math.min(camera.width - 1, Math.max(0, Math.round(roi.x + (x / inputSize) * roi.w)))
      const source = (sourceY * camera.width + sourceX) * 3
      const target = y * inputSize + x
      out[target] = (frame[source] ?? 0) / 255
      out[plane + target] = (frame[source + 1] ?? 0) / 255
      out[2 * plane + target] = (frame[source + 2] ?? 0) / 255
    }
  }
  return out
}

/** Mean confidence of the 21 landmarks, when the model reports one. */
export const handednessOf = (value: number): "left" | "right" => (value > 0.5 ? "right" : "left")
