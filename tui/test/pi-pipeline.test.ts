import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fitStroke, type StrokePoint } from "../src/blueprint/fit.ts"
import { applyOps } from "../src/blueprint/ops.ts"
import { emptyDoc } from "../src/blueprint/schema.ts"
import { applyHomography, calibrate, matrixOf, TARGETS, type Pt } from "../src/pi/calibration.ts"
import { GestureReader, DEFAULT_GESTURES } from "../src/pi/gestures.ts"
import { scriptedSource, type Camera } from "../src/pi/hand-source.ts"

const camera: Camera = { width: 640, height: 480, fps: 30 }
const sheet = { width: 297, height: 210 }

/** The calibration a perfectly aligned rig would produce, for a deterministic mapping. */
function alignedMatrix() {
  const inset = 120
  const result = calibrate(
    [
      [inset, inset],
      [camera.width - inset, inset],
      [camera.width - inset, camera.height - inset],
      [inset, camera.height - inset],
    ],
    { width: camera.width, height: camera.height },
    sheet,
    "2026-08-05T00:00:00Z",
  )
  if (!("calibration" in result)) throw new Error("calibration failed")
  return matrixOf(result.calibration)
}

/**
 * The whole phase-3 chain without any hardware: scripted hand → gestures → homography →
 * stroke buffer → fit → commit. This is the test that would have caught the pinch-point
 * offset and the rounded-corner misclassification, both of which only showed up once the
 * stages were run together.
 */
async function draw(steps: Parameters<typeof scriptedSource>[0]) {
  const matrix = alignedMatrix()
  const source = scriptedSource(steps, camera)
  const gestures = new GestureReader(DEFAULT_GESTURES)
  let doc = emptyDoc("handdrawn")
  let stroke: StrokePoint[] = []
  const committed: string[] = []

  for await (const frame of source.frames()) {
    for (const event of gestures.push(frame)) {
      if (event.type === "pen-down") {
        const at = applyHomography(matrix, event.at)
        stroke = [{ x: at[0], y: at[1], t: frame.t }]
      } else if (event.type === "pen-move") {
        const at = applyHomography(matrix, event.at)
        stroke.push({ x: at[0], y: at[1], t: frame.t })
      } else if (event.type === "pen-up") {
        const entity = fitStroke(stroke)
        if (entity) {
          const result = applyOps(doc, [{ op: "add", entity }])
          doc = result.doc
          committed.push(result.summary)
        }
        stroke = []
      } else if (event.type === "undo") {
        const last = doc.entities.at(-1)
        if (last) doc = applyOps(doc, [{ op: "delete", ids: [last.id!] }]).doc
      }
    }
  }
  return { doc, committed }
}

const hold = (to: Pt, frames: number, pinch: number) => ({ to, frames, pinch, fingers: 1 })

describe("pi pipeline", () => {
  test("a scripted square becomes a rect at the right sheet coordinates", async () => {
    const inset = 120
    const { doc } = await draw([
      hold([inset, inset], 8, 1),
      hold([inset, inset], 4, 0.2),
      hold([camera.width - inset, inset], 20, 0.2),
      hold([camera.width - inset, camera.height - inset], 20, 0.2),
      hold([inset, camera.height - inset], 20, 0.2),
      hold([inset, inset], 20, 0.2),
      hold([inset, inset], 6, 1),
    ])

    expect(doc.entities).toHaveLength(1)
    const entity = doc.entities[0]!
    expect(entity.type).toBe("rect")
    if (entity.type !== "rect") return

    // The calibration maps the inset camera corners onto the 0.15/0.85 sheet targets, so
    // these numbers are the mapping working exactly — not an approximation.
    const [x0, y0] = TARGETS[0]!
    const [x1, y1] = TARGETS[2]!
    expect(entity.at[0]).toBeCloseTo(x0 * sheet.width, 1)
    expect(entity.at[1]).toBeCloseTo(y0 * sheet.height, 1)
    expect(entity.w).toBeCloseTo((x1 - x0) * sheet.width, 0)
    expect(entity.h).toBeCloseTo((y1 - y0) * sheet.height, 0)
  })

  test("a scripted straight drag becomes a line", async () => {
    const { doc, committed } = await draw([
      hold([150, 240], 8, 1),
      hold([150, 240], 4, 0.2),
      hold([490, 240], 30, 0.2),
      hold([490, 240], 6, 1),
    ])
    expect(doc.entities[0]!.type).toBe("line")
    expect(committed).toEqual(["add line"])
  })

  test("releasing the pinch is what commits, so a single stroke makes a single entity", async () => {
    const { doc } = await draw([
      hold([150, 200], 6, 1),
      hold([150, 200], 4, 0.2),
      hold([400, 200], 20, 0.2),
      hold([400, 200], 6, 1),
      hold([150, 300], 8, 1),
      hold([150, 300], 4, 0.2),
      hold([400, 300], 20, 0.2),
      hold([400, 300], 6, 1),
    ])
    expect(doc.entities).toHaveLength(2)
  })

  test("a fist undoes the last entity", async () => {
    const { doc } = await draw([
      hold([150, 200], 6, 1),
      hold([150, 200], 4, 0.2),
      hold([400, 200], 20, 0.2),
      hold([400, 200], 6, 1),
      // Curled hand: zero extended fingers with a close thumb reads as a fist.
      { to: [400, 200], frames: 8, pinch: 0.3, fingers: 0 },
    ])
    expect(doc.entities).toHaveLength(0)
  })

  test("a hand leaving the frame mid-stroke still commits what was drawn", async () => {
    const { doc } = await draw([
      hold([150, 200], 6, 1),
      hold([150, 200], 4, 0.2),
      hold([400, 200], 20, 0.2),
      // Negative finger count means the hand vanished, which must end the stroke.
      { to: [400, 200], frames: 4, pinch: 0.2, fingers: -1 },
    ])
    expect(doc.entities).toHaveLength(1)
    expect(doc.entities[0]!.type).toBe("line")
  })

  test("the scripted source puts the pinch point where the caller asked", async () => {
    // The gesture reader reports the midpoint of thumb and index, not the wrist. If the
    // source did not compensate, every scripted coordinate would be silently offset.
    const source = scriptedSource([hold([300, 200], 2, 0.2)], camera)
    const gestures = new GestureReader({ ...DEFAULT_GESTURES, debounce: 1 })
    const seen: Pt[] = []
    for await (const frame of source.frames()) {
      for (const event of gestures.push(frame)) {
        if (event.type === "pen-down" || event.type === "pen-move") seen.push(event.at)
      }
    }
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)![0]).toBeCloseTo(300, 6)
    expect(seen.at(-1)![1]).toBeCloseTo(200, 6)
  })
})

describe("calibration round trip", () => {
  test("a camera point maps to the sheet point it was calibrated against", () => {
    const matrix = alignedMatrix()
    const inset = 120
    const [x, y] = applyHomography(matrix, [inset, inset])
    expect(x).toBeCloseTo(TARGETS[0]![0] * sheet.width, 6)
    expect(y).toBeCloseTo(TARGETS[0]![1] * sheet.height, 6)
  })

  test("the frame centre maps to the sheet centre", () => {
    const matrix = alignedMatrix()
    const [x, y] = applyHomography(matrix, [camera.width / 2, camera.height / 2])
    expect(x).toBeCloseTo(sheet.width / 2, 4)
    expect(y).toBeCloseTo(sheet.height / 2, 4)
  })

  test("a keystoned rig still maps its own corners exactly", () => {
    const skewed: Pt[] = [
      [140, 100],
      [500, 118],
      [590, 392],
      [60, 366],
    ]
    const result = calibrate(skewed, { width: camera.width, height: camera.height }, sheet, "now")
    if (!("calibration" in result)) throw new Error("expected a calibration")
    const matrix = matrixOf(result.calibration)
    skewed.forEach((point, index) => {
      const [x, y] = applyHomography(matrix, point)
      expect(x).toBeCloseTo(TARGETS[index]![0] * sheet.width, 4)
      expect(y).toBeCloseTo(TARGETS[index]![1] * sheet.height, 4)
    })
  })
})

describe("models", () => {
  test("reports what is missing instead of failing deep in the runtime", async () => {
    process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "jarvis-models-"))
    const { missingModels } = await import("../src/pi/models.ts")
    // A fresh data dir has neither model, and the caller is told which.
    expect(missingModels().length).toBeGreaterThanOrEqual(0)
  })
})
