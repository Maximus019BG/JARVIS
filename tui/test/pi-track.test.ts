import { describe, expect, test } from "bun:test"
import { generateAnchors, PALM_ANCHORS, type Roi } from "../src/pi/detect.ts"
import { createTracker, type Ort } from "../src/pi/track.ts"

/**
 * A stand-in for onnxruntime: the palm "detector" finds a palm at each anchor given a score,
 * and the landmark "model" answers with the next presence from `presence` (1 once empty).
 * The tracker only ever sees this structural surface, which is why `ort` is injected.
 */
function fakeOrt(palms: { at: [number, number]; score: number }[], presence: number[] = []): Ort {
  const anchors = generateAnchors(PALM_ANCHORS)
  const nearest = ([x, y]: [number, number]) =>
    anchors.reduce((best, anchor, i) => (Math.hypot(anchor.cx - x, anchor.cy - y) < Math.hypot(anchors[best]!.cx - x, anchors[best]!.cy - y) ? i : best), 0)
  const scores = new Float32Array(anchors.length).fill(-10)
  const boxes = new Float32Array(anchors.length * 18)
  for (const palm of palms) {
    const i = nearest(palm.at)
    scores[i] = palm.score
    boxes[i * 18 + 2] = 30 // w and h in detector pixels
    boxes[i * 18 + 3] = 30
  }
  const session = (outputNames: string[], outputs: () => Record<string, { data: Float32Array; dims: number[] }>) => ({
    inputNames: ["input"],
    outputNames,
    run: async () => outputs(),
  })
  const palm = session(["scores", "boxes"], () => ({
    scores: { data: scores, dims: [1, anchors.length, 1] },
    boxes: { data: boxes, dims: [1, anchors.length, 18] },
  }))
  const landmark = session(["coords", "presence"], () => ({
    coords: { data: new Float32Array(63), dims: [1, 63] },
    presence: { data: new Float32Array([presence.shift() ?? 1]), dims: [1, 1] },
  }))
  return {
    Tensor: class {
      constructor(
        readonly type: string,
        readonly data: Float32Array,
        readonly dims: readonly number[],
      ) {}
    },
    InferenceSession: { create: async (path: string) => (path === "palm" ? palm : landmark) },
  } as unknown as Ort
}

const camera = { width: 640, height: 480 }
const rgb = new Uint8Array(camera.width * camera.height * 3)
const paths = { palm: "palm", landmark: "landmark" }
const centreX = (roi: Roi) => roi.x + roi.w / 2

describe("createTracker", () => {
  test("finds two hands and returns a region for each", async () => {
    const tracker = await createTracker(fakeOrt([{ at: [0.3, 0.5], score: 8 }, { at: [0.7, 0.5], score: 6 }]), paths)
    const result = await tracker.step(rgb, camera, { detect: true })
    expect(result.hands).toHaveLength(2)
    expect(result.rois).toHaveLength(2)
  })

  test("a hand that leaves its region is dropped, and the other is kept", async () => {
    const ort = fakeOrt([{ at: [0.3, 0.5], score: 8 }, { at: [0.7, 0.5], score: 6 }], [1, 1, 1, 0.1])
    const tracker = await createTracker(ort, paths)
    const first = await tracker.step(rgb, camera, { detect: true })
    const next = await tracker.step(rgb, camera, { rois: first.rois, detect: false })
    expect(next.hands).toHaveLength(1)
    expect(next.rois).toEqual([first.rois![0]!])
  })

  test("a re-detect keeps the hand that was first, first", async () => {
    // By score the left palm comes first; the right one is the hand being followed.
    const tracker = await createTracker(fakeOrt([{ at: [0.3, 0.5], score: 8 }, { at: [0.7, 0.5], score: 6 }]), paths)
    const found = await tracker.step(rgb, camera, { detect: true })
    const [left, right] = found.rois!
    expect(centreX(left!)).toBeLessThan(centreX(right!))

    const again = await tracker.step(rgb, camera, { rois: [right!], detect: true })
    expect(centreX(again.rois![0]!)).toBeCloseTo(centreX(right!), 6)
  })

  test("no palm, no hands — and no region, so the next frame detects again", async () => {
    const tracker = await createTracker(fakeOrt([]), paths)
    expect(await tracker.step(rgb, camera, { detect: true })).toEqual({ hands: [] })
  })
})
