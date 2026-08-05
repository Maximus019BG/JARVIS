import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { dataDir } from "../config/paths.ts"

export type Pt = [number, number]

/** Row-major 3×3, applied to homogeneous coordinates. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number]

export const IDENTITY: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * Solves `A x = b` by Gauss-Jordan with partial pivoting. Small and self-contained
 * because pulling in a linear algebra library for one 8×8 solve would be silly.
 */
function solve(a: number[][], b: number[]): number[] | undefined {
  const n = b.length
  const m = a.map((row, index) => [...row, b[index]!])

  for (let column = 0; column < n; column++) {
    // Pivoting is not optional here: a calibration where two points share an axis
    // produces a zero on the diagonal, and without the swap the solve silently divides
    // by it and returns NaN.
    let pivot = column
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(m[row]![column]!) > Math.abs(m[pivot]![column]!)) pivot = row
    }
    if (Math.abs(m[pivot]![column]!) < 1e-10) return undefined
    ;[m[column], m[pivot]] = [m[pivot]!, m[column]!]

    const divisor = m[column]![column]!
    for (let k = column; k <= n; k++) m[column]![k]! /= divisor
    for (let row = 0; row < n; row++) {
      if (row === column) continue
      const factor = m[row]![column]!
      if (factor === 0) continue
      for (let k = column; k <= n; k++) m[row]![k]! -= factor * m[column]![k]!
    }
  }
  return m.map((row) => row[n]!)
}

/**
 * The homography mapping four source points onto four destination points.
 *
 * Eight unknowns (h33 is fixed at 1), so four correspondences determine it exactly. This
 * is what turns "where the camera saw the fingertip" into "where that is on the projected
 * sheet" — the projector and the camera never share a viewpoint, so without it every
 * stroke lands offset and skewed.
 */
export function homographyFrom(source: readonly Pt[], destination: readonly Pt[]): Homography | undefined {
  if (source.length < 4 || destination.length < 4) return undefined

  const rows: number[][] = []
  const values: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = source[i]!
    const [u, v] = destination[i]!
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    values.push(u)
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    values.push(v)
  }

  const h = solve(rows, values)
  if (!h || h.some((value) => !Number.isFinite(value))) return undefined
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1]
}

export function applyHomography(h: Homography, [x, y]: Pt): Pt {
  const w = h[6] * x + h[7] * y + h[8]
  if (Math.abs(w) < 1e-12) return [x, y]
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]
}

/** Mean reprojection error, in destination units — the number that says if it worked. */
export function reprojectionError(h: Homography, source: readonly Pt[], destination: readonly Pt[]): number {
  let total = 0
  for (let i = 0; i < source.length; i++) {
    const [x, y] = applyHomography(h, source[i]!)
    const [u, v] = destination[i]!
    total += Math.hypot(x - u, y - v)
  }
  return total / source.length
}

const CalibrationSchema = z.object({
  matrix: z.array(z.number()).length(9),
  /** Invalidated when the camera resolution changes — the mapping is resolution-specific. */
  camera: z.object({ width: z.number(), height: z.number() }),
  /** The projected sheet the matrix maps onto. */
  sheet: z.object({ width: z.number(), height: z.number() }),
  error: z.number(),
  at: z.string(),
})

export type Calibration = z.infer<typeof CalibrationSchema>

export const calibrationPath = join(dataDir, "calibration.json")

/**
 * The four targets, as fractions of the sheet. Inset from the corners because a projector
 * aimed at a desk usually has its worst focus and keystone right at the edges, and a
 * fingertip pressed into a corner is also the least accurately tracked.
 */
export const TARGETS: readonly Pt[] = [
  [0.15, 0.15],
  [0.85, 0.15],
  [0.85, 0.85],
  [0.15, 0.85],
]

export function saveCalibration(calibration: Calibration, path = calibrationPath): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(calibration, null, 2)}\n`)
}

export function loadCalibration(path = calibrationPath): Calibration | undefined {
  if (!existsSync(path)) return undefined
  const parsed = CalibrationSchema.safeParse(JSON.parse(readFileSync(path, "utf8")))
  return parsed.success ? parsed.data : undefined
}

/**
 * The calibration to actually use, or undefined when it cannot be trusted. A stale
 * calibration is worse than none: it silently draws in the wrong place, whereas a missing
 * one can be reported.
 */
export function usableCalibration(
  camera: { width: number; height: number },
  path = calibrationPath,
): { calibration: Calibration } | { stale: string } {
  const found = loadCalibration(path)
  if (!found) return { stale: "not calibrated — run `jarvis pi calibrate`" }
  if (found.camera.width !== camera.width || found.camera.height !== camera.height) {
    return {
      stale: `calibrated at ${found.camera.width}×${found.camera.height} but the camera is ${camera.width}×${camera.height} — recalibrate`,
    }
  }
  return { calibration: found }
}

/** Builds a calibration from captured camera points, in the order of `TARGETS`. */
export function calibrate(
  cameraPoints: readonly Pt[],
  camera: { width: number; height: number },
  sheet: { width: number; height: number },
  now: string,
): { calibration: Calibration } | { error: string } {
  if (cameraPoints.length !== TARGETS.length) {
    return { error: `expected ${TARGETS.length} points, got ${cameraPoints.length}` }
  }
  const sheetPoints = TARGETS.map(([fx, fy]): Pt => [fx * sheet.width, fy * sheet.height])
  const matrix = homographyFrom(cameraPoints, sheetPoints)
  if (!matrix) {
    return { error: "those four points are degenerate — they must not be collinear or coincident" }
  }
  const error = reprojectionError(matrix, cameraPoints, sheetPoints)
  return {
    calibration: {
      matrix: [...matrix],
      camera,
      sheet,
      error,
      at: now,
    },
  }
}

export const matrixOf = (calibration: Calibration): Homography => calibration.matrix as unknown as Homography
