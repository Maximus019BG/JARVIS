import { describe, expect, test } from "bun:test"
import {
  assertAnchorCount,
  clampRoi,
  cropToTensor,
  decodeDetections,
  generateAnchors,
  iou,
  landmarksToCamera,
  nms,
  PALM_ANCHORS,
  PALM_ANCHORS_128,
  roiFromPalm,
  sigmoid,
  type Box,
} from "../src/pi/detect.ts"

const camera = { width: 640, height: 480 }

describe("anchors", () => {
  test("matches the counts the real MediaPipe models publish", () => {
    // These two numbers are the guard on the whole config: 24²×2 + 12²×6 = 2016 for the
    // 192 model, 16²×2 + 8²×6 = 896 for the 128 one. A typo in strides or perCell moves
    // them, and a wrong anchor count misplaces every detected hand without erroring.
    expect(generateAnchors(PALM_ANCHORS)).toHaveLength(2016)
    expect(generateAnchors(PALM_ANCHORS_128)).toHaveLength(896)
  })

  test("assertAnchorCount refuses a mismatched model instead of decoding nonsense", () => {
    const anchors = generateAnchors(PALM_ANCHORS)
    expect(() => assertAnchorCount(2016, anchors)).not.toThrow()
    expect(() => assertAnchorCount(896, anchors)).toThrow(/wrong model variant/)
  })

  test("centres sit inside the unit square", () => {
    for (const anchor of generateAnchors(PALM_ANCHORS)) {
      expect(anchor.cx).toBeGreaterThan(0)
      expect(anchor.cx).toBeLessThan(1)
      expect(anchor.cy).toBeGreaterThan(0)
      expect(anchor.cy).toBeLessThan(1)
    }
  })
})

describe("decodeDetections", () => {
  const anchors = [
    { cx: 0.5, cy: 0.5 },
    { cx: 0.25, cy: 0.25 },
  ]

  test("recovers a box from its regressor offsets", () => {
    const regressors = new Float32Array(2 * 18)
    // Centred on the anchor, 96/192 = half the frame wide and tall.
    regressors.set([0, 0, 96, 96], 0)
    const scores = new Float32Array([10, -10])

    const boxes = decodeDetections(regressors, scores, anchors, { inputSize: 192, threshold: 0.5 })
    expect(boxes).toHaveLength(1)
    expect(boxes[0]!.x).toBeCloseTo(0.25, 5)
    expect(boxes[0]!.y).toBeCloseTo(0.25, 5)
    expect(boxes[0]!.w).toBeCloseTo(0.5, 5)
    expect(boxes[0]!.score).toBeGreaterThan(0.99)
  })

  test("a hugely negative logit gives 0, not NaN", () => {
    // Math.exp(800) is Infinity, and 1/(1+Infinity) must come out as 0.
    expect(sigmoid(-800)).toBe(0)
    expect(Number.isNaN(sigmoid(-800))).toBe(false)
    const boxes = decodeDetections(new Float32Array(18), new Float32Array([-800]), [anchors[0]!], {
      inputSize: 192,
      threshold: 0.5,
    })
    expect(boxes).toEqual([])
  })

  test("drops degenerate boxes rather than emitting negative sizes", () => {
    const regressors = new Float32Array(18)
    regressors.set([0, 0, 0, 0], 0)
    expect(
      decodeDetections(regressors, new Float32Array([10]), [anchors[0]!], { inputSize: 192, threshold: 0.5 }),
    ).toEqual([])
  })

  test("stops cleanly when the score tensor is shorter than the anchor list", () => {
    expect(() =>
      decodeDetections(new Float32Array(18), new Float32Array([10]), anchors, {
        inputSize: 192,
        threshold: 0.5,
      }),
    ).not.toThrow()
  })
})

describe("nms", () => {
  const box = (x: number, score: number): Box => ({ x, y: 0, w: 1, h: 1, score })

  test("keeps the best of a heavily overlapping cluster", () => {
    const kept = nms([box(0, 0.6), box(0.05, 0.9), box(0.1, 0.7)], 0.3)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.score).toBe(0.9)
  })

  test("keeps genuinely separate hands", () => {
    expect(nms([box(0, 0.9), box(5, 0.8)], 0.3)).toHaveLength(2)
  })

  test("respects the limit", () => {
    expect(nms([box(0, 0.9), box(5, 0.8), box(10, 0.7)], 0.3, 2)).toHaveLength(2)
  })

  test("iou is 1 for identical boxes and 0 for disjoint ones", () => {
    expect(iou(box(0, 1), box(0, 1))).toBeCloseTo(1, 6)
    expect(iou(box(0, 1), box(9, 1))).toBe(0)
  })
})

describe("roi", () => {
  test("expands past the palm so the fingers are inside the crop", () => {
    const palm: Box = { x: 0.4, y: 0.4, w: 0.1, h: 0.1, score: 0.9 }
    const roi = roiFromPalm(palm, camera)
    // 0.1 of 640 is 64px; 2.6× is 166px.
    expect(roi.w).toBeCloseTo(64 * 2.6, 3)
    expect(roi.w).toBe(roi.h)
    // Shifted up, because a hand extends away from the wrist.
    expect(roi.y + roi.h / 2).toBeLessThan((palm.y + palm.h / 2) * camera.height)
  })

  test("stays square when clamped to the frame edge", () => {
    const roi = clampRoi({ x: -80, y: -50, w: 200, h: 200 }, camera)
    expect(roi.w).toBe(roi.h)
    expect(roi.x).toBe(0)
    expect(roi.y).toBe(0)
  })

  test("a crop bigger than the frame shrinks to fit rather than overflowing", () => {
    const roi = clampRoi({ x: 0, y: 0, w: 2000, h: 2000 }, camera)
    expect(roi.w).toBe(480)
    expect(roi.x + roi.w).toBeLessThanOrEqual(camera.width)
    expect(roi.y + roi.h).toBeLessThanOrEqual(camera.height)
  })
})

describe("landmarksToCamera", () => {
  test("undoes the crop scale and offset", () => {
    const roi = { x: 100, y: 50, w: 224, h: 224 }
    // Model input is 224, so its coordinates map 1:1 plus the offset.
    const raw = new Float32Array([0, 0, 0, 224, 224, 0, 112, 112, 0])
    const marks = landmarksToCamera(raw, roi, { inputSize: 224, count: 3 })
    expect(marks[0]).toMatchObject({ x: 100, y: 50 })
    expect(marks[1]).toMatchObject({ x: 324, y: 274 })
    expect(marks[2]).toMatchObject({ x: 212, y: 162 })
  })

  test("scales when the crop and the model input differ", () => {
    const roi = { x: 0, y: 0, w: 448, h: 448 }
    const raw = new Float32Array([112, 112, 0])
    const marks = landmarksToCamera(raw, roi, { inputSize: 224, count: 1 })
    // Half way through a 224 input is half way through a 448 crop.
    expect(marks[0]!.x).toBeCloseTo(224, 6)
  })

  test("a landmark at the crop centre lands at the crop centre in camera space", () => {
    // The invariant that matters: get this wrong and every stroke is displaced.
    const roi = clampRoi(roiFromPalm({ x: 0.3, y: 0.5, w: 0.15, h: 0.15, score: 1 }, camera), camera)
    const raw = new Float32Array([96, 96, 0])
    const marks = landmarksToCamera(raw, roi, { inputSize: 192, count: 1 })
    expect(marks[0]!.x).toBeCloseTo(roi.x + roi.w / 2, 6)
    expect(marks[0]!.y).toBeCloseTo(roi.y + roi.h / 2, 6)
  })

  test("always returns the requested number of landmarks, even on a short tensor", () => {
    expect(landmarksToCamera(new Float32Array(3), { x: 0, y: 0, w: 10, h: 10 }, { inputSize: 10 })).toHaveLength(21)
  })
})

describe("cropToTensor", () => {
  /** A frame where every pixel encodes its own column, so sampling is checkable. */
  function ramp(width: number, height: number): Uint8Array {
    const frame = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 3
        frame[at] = x % 256
        frame[at + 1] = y % 256
        frame[at + 2] = 128
      }
    }
    return frame
  }

  test("writes a normalised NCHW tensor of the right size", () => {
    const tensor = cropToTensor(ramp(64, 64), { width: 64, height: 64 }, { x: 0, y: 0, w: 64, h: 64 }, 8)
    expect(tensor).toHaveLength(3 * 8 * 8)
    for (const value of tensor) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    // Channels are planar: the blue plane is a constant 128/255 throughout.
    expect(tensor[2 * 64]).toBeCloseTo(128 / 255, 5)
  })

  test("samples from the requested region, not the origin", () => {
    const frame = ramp(64, 64)
    const offset = cropToTensor(frame, { width: 64, height: 64 }, { x: 32, y: 0, w: 8, h: 8 }, 8)
    // Red channel carries the column, so a crop starting at x=32 must start near 32/255.
    expect(offset[0]).toBeCloseTo(32 / 255, 2)
  })

  test("clamps rather than reading outside the frame", () => {
    const frame = ramp(32, 32)
    expect(() =>
      cropToTensor(frame, { width: 32, height: 32 }, { x: -20, y: -20, w: 100, h: 100 }, 16),
    ).not.toThrow()
    const tensor = cropToTensor(frame, { width: 32, height: 32 }, { x: -20, y: -20, w: 100, h: 100 }, 16)
    expect([...tensor].every((value) => Number.isFinite(value))).toBe(true)
  })

  test("reuses the caller's buffer, so a 30fps loop allocates nothing", () => {
    const buffer = new Float32Array(3 * 8 * 8)
    const returned = cropToTensor(ramp(32, 32), { width: 32, height: 32 }, { x: 0, y: 0, w: 32, h: 32 }, 8, buffer)
    expect(returned).toBe(buffer)
  })
})
