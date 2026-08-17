import { describe, expect, test } from "bun:test"
import {
  applyHomography,
  calibrate,
  homographyFrom,
  reprojectionError,
  saveCalibration,
  TARGETS,
  usableCalibration,
  type Pt,
} from "../src/pi/calibration.ts"
import {
  DEFAULT_GESTURES,
  GestureReader,
  extendedFingers,
  isFist,
  isOpenPalm,
  isPointing,
  pinchRatio,
  type Frame,
  type Hand,
} from "../src/pi/gestures.ts"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * A synthetic hand. Landmarks are laid out like a real one — wrist at the bottom, knuckles
 * above it, fingers above those — so the same ratios the real detector produces apply.
 * `pinch` is the thumb-to-index gap in hand spans; `fingers` is how many are extended.
 */
function hand(options: {
  x?: number
  y?: number
  pinch?: number
  fingers?: number
  score?: number
  span?: number
}): Hand {
  const { x = 100, y = 100, pinch = 1, fingers = 4, score = 0.9, span = 60 } = options
  const landmarks = Array.from({ length: 21 }, () => ({ x, y }))
  landmarks[0] = { x, y: y + span } // wrist
  landmarks[9] = { x, y } // middle mcp — span above the wrist
  landmarks[5] = { x: x - 12, y } // index mcp
  landmarks[17] = { x: x + 12, y } // pinky mcp

  // A finger counts as extended when its tip is further from the wrist than its pip.
  const place = (tip: number, pip: number, offsetX: number, extended: boolean) => {
    landmarks[pip] = { x: x + offsetX, y: y - span * 0.25 }
    landmarks[tip] = { x: x + offsetX, y: extended ? y - span * 0.8 : y + span * 0.5 }
  }
  place(8, 6, -12, fingers >= 1)
  place(12, 10, 0, fingers >= 2)
  place(16, 14, 8, fingers >= 3)
  place(20, 18, 16, fingers >= 4)

  // Thumb sits `pinch` hand-spans from the index tip, along x.
  const index = landmarks[8]!
  landmarks[4] = { x: index.x + pinch * span, y: index.y }
  return { score, landmarks }
}

const frame = (t: number, ...hands: Hand[]): Frame => ({ t, hands })

describe("hand geometry", () => {
  test("pinch ratio is scale-invariant", () => {
    // Same gesture, hand twice as far from the camera: the ratio must not move.
    expect(pinchRatio(hand({ pinch: 0.2, span: 60 }))).toBeCloseTo(0.2, 5)
    expect(pinchRatio(hand({ pinch: 0.2, span: 30 }))).toBeCloseTo(0.2, 5)
  })

  test("counts extended fingers", () => {
    expect(extendedFingers(hand({ fingers: 4 }))).toBe(4)
    expect(extendedFingers(hand({ fingers: 0 }))).toBe(0)
    expect(extendedFingers(hand({ fingers: 1 }))).toBe(1)
  })

  test("recognises palm, fist and pointing", () => {
    expect(isOpenPalm(hand({ fingers: 4 }))).toBe(true)
    expect(isFist(hand({ fingers: 0, pinch: 0.3 }))).toBe(true)
    expect(isPointing(hand({ fingers: 1 }))).toBe(true)
    expect(isPointing(hand({ fingers: 4 }))).toBe(false)
  })
})

describe("GestureReader", () => {
  const reader = () => new GestureReader({ ...DEFAULT_GESTURES, debounce: 2 })

  /** Feeds the same hand for n frames and returns everything emitted. */
  function feed(gestures: GestureReader, count: number, make: (index: number) => Hand, start = 0) {
    const events = []
    for (let i = 0; i < count; i++) events.push(...gestures.push(frame(start + i * 16, make(i))))
    return events
  }

  test("a pinch starts a stroke and releasing ends it", () => {
    const gestures = reader()
    const down = feed(gestures, 4, () => hand({ pinch: 0.2, fingers: 1 }))
    expect(down[0]).toMatchObject({ type: "pen-down" })
    expect(down.filter((event) => event.type === "pen-move").length).toBeGreaterThan(0)
    expect(gestures.isDrawing).toBe(true)

    const up = feed(gestures, 4, () => hand({ pinch: 1, fingers: 1 }), 100)
    expect(up.some((event) => event.type === "pen-up")).toBe(true)
    expect(gestures.isDrawing).toBe(false)
  })

  test("a single bad frame does not break a stroke", () => {
    const gestures = reader()
    feed(gestures, 4, () => hand({ pinch: 0.2, fingers: 1 }))
    // One frame of a spuriously open hand, then back to pinching.
    const events = gestures.push(frame(200, hand({ pinch: 1, fingers: 1 })))
    expect(events.some((event) => event.type === "pen-up")).toBe(false)
    expect(gestures.isDrawing).toBe(true)
  })

  test("hysteresis: a ratio between the two thresholds holds its state", () => {
    const gestures = reader()
    const between = (DEFAULT_GESTURES.pinchEnter + DEFAULT_GESTURES.pinchExit) / 2

    // Not pinching yet, and a mid-band value must not start a stroke.
    feed(gestures, 4, () => hand({ pinch: between, fingers: 1 }))
    expect(gestures.isDrawing).toBe(false)

    // Now close properly, then relax back into the band: the stroke must survive.
    feed(gestures, 4, () => hand({ pinch: 0.2, fingers: 1 }), 100)
    expect(gestures.isDrawing).toBe(true)
    feed(gestures, 6, () => hand({ pinch: between, fingers: 1 }), 200)
    expect(gestures.isDrawing).toBe(true)
  })

  test("losing the hand ends the stroke rather than leaving it open", () => {
    const gestures = reader()
    feed(gestures, 4, () => hand({ pinch: 0.2, fingers: 1 }))
    const events = gestures.push(frame(300, ...[]))
    expect(events).toEqual([{ type: "pen-up" }])
    expect(gestures.isDrawing).toBe(false)
  })

  test("a low-confidence hand is ignored", () => {
    const gestures = reader()
    const events = feed(gestures, 5, () => hand({ pinch: 0.2, fingers: 1, score: 0.2 }))
    expect(events.filter((event) => event.type === "pen-down")).toHaveLength(0)
  })

  test("an open palm cancels, ending any stroke first", () => {
    const gestures = reader()
    feed(gestures, 4, () => hand({ pinch: 0.2, fingers: 1 }))
    const events = feed(gestures, 4, () => hand({ pinch: 1, fingers: 4 }), 100)
    expect(events.some((event) => event.type === "pen-up")).toBe(true)
    expect(events.some((event) => event.type === "cancel")).toBe(true)
  })

  test("a fist undoes", () => {
    const gestures = reader()
    const events = feed(gestures, 5, () => hand({ pinch: 0.3, fingers: 0 }))
    expect(events.some((event) => event.type === "undo")).toBe(true)
  })

  test("pointing opens the palette only after the hold time", () => {
    const gestures = reader()
    // 200ms of pointing is not enough for the 400ms hold.
    const early = feed(gestures, 12, () => hand({ fingers: 1, pinch: 1 }), 0)
    expect(early.some((event) => event.type === "palette")).toBe(false)

    const later = gestures.push(frame(500, hand({ fingers: 1, pinch: 1 })))
    expect(later.some((event) => event.type === "palette")).toBe(true)

    // And only once per hold.
    const again = gestures.push(frame(900, hand({ fingers: 1, pinch: 1 })))
    expect(again.some((event) => event.type === "palette")).toBe(false)
  })

  test("two pinching hands zoom instead of drawing", () => {
    const gestures = reader()
    const left = hand({ x: 100, pinch: 0.2, fingers: 1 })
    const right = hand({ x: 200, pinch: 0.2, fingers: 1 })
    gestures.push(frame(0, left, right))

    const wider = hand({ x: 300, pinch: 0.2, fingers: 1 })
    const events = gestures.push(frame(16, left, wider))
    const zoom = events.find((event) => event.type === "zoom")
    expect(zoom).toBeDefined()
    if (zoom?.type !== "zoom") return
    expect(zoom.scale).toBeGreaterThan(1)
  })

  test("small two-hand drift does not register as a zoom", () => {
    const gestures = reader()
    const left = hand({ x: 100, pinch: 0.2, fingers: 1 })
    gestures.push(frame(0, left, hand({ x: 200, pinch: 0.2, fingers: 1 })))
    const events = gestures.push(frame(16, left, hand({ x: 202, pinch: 0.2, fingers: 1 })))
    expect(events.some((event) => event.type === "zoom")).toBe(false)
  })
})

describe("calibration", () => {
  const camera = { width: 640, height: 480 }
  const sheet = { width: 297, height: 210 }

  test("recovers an exact mapping from four correspondences", () => {
    const source: Pt[] = [
      [0, 0],
      [640, 0],
      [640, 480],
      [0, 480],
    ]
    const destination: Pt[] = [
      [0, 0],
      [297, 0],
      [297, 210],
      [0, 210],
    ]
    const h = homographyFrom(source, destination)!
    expect(reprojectionError(h, source, destination)).toBeLessThan(1e-6)
    expect(applyHomography(h, [320, 240])[0]).toBeCloseTo(148.5, 4)
    expect(applyHomography(h, [320, 240])[1]).toBeCloseTo(105, 4)
  })

  test("handles a keystoned projection, which is the whole point", () => {
    // A projector aimed down at a desk sees a trapezoid, not a rectangle.
    const source: Pt[] = [
      [120, 90],
      [520, 100],
      [600, 400],
      [40, 380],
    ]
    const destination = TARGETS.map(([fx, fy]): Pt => [fx * sheet.width, fy * sheet.height])
    const h = homographyFrom(source, destination)!
    expect(reprojectionError(h, source, destination)).toBeLessThan(1e-6)
  })

  test("survives points that would put a zero on the diagonal", () => {
    // Two points sharing a coordinate is exactly the case that needs pivoting.
    const source: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]
    const destination: Pt[] = [
      [10, 10],
      [90, 12],
      [88, 88],
      [12, 90],
    ]
    const h = homographyFrom(source, destination)
    expect(h).toBeDefined()
    expect(reprojectionError(h!, source, destination)).toBeLessThan(1e-6)
  })

  test("refuses a degenerate set instead of returning nonsense", () => {
    const collinear: Pt[] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ]
    expect(homographyFrom(collinear, collinear)).toBeUndefined()
    const result = calibrate(collinear, camera, sheet, "now")
    expect("error" in result).toBe(true)
  })

  test("calibrate reports its own reprojection error", () => {
    const source: Pt[] = [
      [120, 90],
      [520, 100],
      [600, 400],
      [40, 380],
    ]
    const result = calibrate(source, camera, sheet, "2026-08-05T00:00:00Z")
    expect("calibration" in result).toBe(true)
    if (!("calibration" in result)) return
    expect(result.calibration.error).toBeLessThan(1e-6)
    expect(result.calibration.camera).toEqual(camera)
  })

  test("a calibration from a different camera resolution is rejected, not silently used", () => {
    const path = join(mkdtempSync(join(tmpdir(), "jarvis-cal-")), "calibration.json")
    const result = calibrate(
      [
        [120, 90],
        [520, 100],
        [600, 400],
        [40, 380],
      ],
      camera,
      sheet,
      "now",
    )
    if (!("calibration" in result)) throw new Error("expected a calibration")
    saveCalibration(result.calibration, path)

    expect(usableCalibration(camera, path)).toHaveProperty("calibration")
    const stale = usableCalibration({ width: 1280, height: 720 }, path)
    expect(stale).toHaveProperty("stale")
  })

  test("missing calibration is reported rather than guessed", () => {
    expect(usableCalibration(camera, join(tmpdir(), "definitely-not-here.json"))).toHaveProperty("stale")
  })
})
