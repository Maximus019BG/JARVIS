import type { Entity, PathCommand, Pt } from "./schema.ts"

/** A raw sample from a fingertip: document coordinates plus a timestamp in ms. */
export type StrokePoint = { x: number; y: number; t: number }

export type Tool = "auto" | "line" | "polyline" | "rect" | "circle" | "arc" | "path"

export type FitOptions = {
  /** RDP epsilon, in document units. Bigger throws away more wobble. */
  tolerance?: number
  /** Exponential smoothing factor, 0 (none) to just under 1 (heavy). */
  smoothing?: number
  /** Round coordinates to this grid. 0 disables. */
  snapGrid?: number
  /** Existing endpoints worth snapping to, so shapes actually join up. */
  snapPoints?: readonly Pt[]
  snapRadius?: number
  /**
   * The active palette tool. `auto` classifies the stroke; anything else forces that
   * shape, because a user who picked the circle tool and drew a wobbly oval wants a circle.
   */
  tool?: Tool
}

/** Starting points for the fit knobs. Exported so the Pi config has one source for them. */
export const DEFAULT_FIT = { tolerance: 1.2, smoothing: 0.35, snapGrid: 0, snapRadius: 3 }

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1])

/**
 * Zero-lag smoothing. Hand tracking jitters by a millimetre or two even when the finger is
 * still, and without filtering RDP faithfully preserves that tremor as extra vertices.
 *
 * A single forward pass would lag: the last sample comes out pulled back toward the
 * previous ones, so every stroke stops short of where the finger actually did. Running the
 * one-pole filter forwards then backwards cancels the phase shift, and the two endpoints
 * are pinned to the raw values on top — those are exactly the coordinates that have to be
 * right, because they are where shapes join.
 */
function smooth(points: readonly StrokePoint[], factor: number): Pt[] {
  if (points.length === 0) return []
  const raw: Pt[] = points.map((point) => [point.x, point.y])
  if (raw.length < 3) return raw

  const alpha = 1 - Math.min(0.95, Math.max(0, factor))
  const pass = (input: readonly Pt[]): Pt[] => {
    let x = input[0]![0]
    let y = input[0]![1]
    const out: Pt[] = [[x, y]]
    for (const point of input.slice(1)) {
      x += (point[0] - x) * alpha
      y += (point[1] - y) * alpha
      out.push([x, y])
    }
    return out
  }

  const forward = pass(raw)
  const both = pass([...forward].reverse()).reverse()
  both[0] = raw[0]!
  both[both.length - 1] = raw.at(-1)!
  return both
}

/** Drops points closer together than `min`, which are all noise at drawing speed. */
function thin(points: readonly Pt[], min: number): Pt[] {
  const out: Pt[] = []
  for (const point of points) {
    if (out.length === 0 || dist(out.at(-1)!, point) >= min) out.push(point)
  }
  if (out.length > 1 && points.length > 1) out[out.length - 1] = points.at(-1)!
  return out
}

/** Perpendicular distance from `p` to the segment a-b. */
function perpendicular(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared))
  return dist(p, [a[0] + t * dx, a[1] + t * dy])
}

/** Ramer–Douglas–Peucker, iterative so a long stroke cannot blow the stack. */
export function simplify(points: readonly Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length > 0) {
    const [start, end] = stack.pop()!
    let worst = 0
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const deviation = perpendicular(points[i]!, points[start]!, points[end]!)
      if (deviation > worst) {
        worst = deviation
        index = i
      }
    }
    if (index >= 0 && worst > epsilon) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }
  return points.filter((_, index) => keep[index] === 1)
}

/** Signed turn at `b`, in degrees: 0 is straight on, 180 doubles back. */
function turn(a: Pt, b: Pt, c: Pt): number {
  const angle =
    Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])
  return Math.abs(((angle * 180) / Math.PI + 540) % 360 - 180)
}

const centroid = (points: readonly Pt[]): Pt => [
  points.reduce((sum, point) => sum + point[0], 0) / points.length,
  points.reduce((sum, point) => sum + point[1], 0) / points.length,
]

/** How circular a closed stroke is: mean radius and the spread around it. */
function circularity(points: readonly Pt[]): { c: Pt; r: number; spread: number } {
  const c = centroid(points)
  const radii = points.map((point) => dist(c, point))
  const r = radii.reduce((sum, value) => sum + value, 0) / radii.length
  const variance = radii.reduce((sum, value) => sum + (value - r) ** 2, 0) / radii.length
  return { c, r, spread: r > 0 ? Math.sqrt(variance) / r : Infinity }
}

const isClosed = (points: readonly Pt[], span: number) =>
  points.length > 3 && dist(points[0]!, points.at(-1)!) < Math.max(span * 0.18, 2)

/** Shoelace area, unsigned. */
function polygonArea(points: readonly Pt[]): number {
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    total += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(total) / 2
}

/**
 * How much of its own bounding box a closed stroke fills. A rectangle fills essentially
 * all of it, a circle π/4 ≈ 0.79, a triangle or diamond about a half.
 *
 * This replaces counting simplified vertices, which only worked on synthetically sharp
 * corners: smoothing a real hand-drawn square rounds its corners enough that RDP keeps six
 * or eight points, and a vertex count then reads it as a polyline. Area is indifferent to
 * how rounded the corners are.
 */
function boxFill(points: readonly Pt[]): number {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
  return box > 0 ? polygonArea(points) / box : 0
}

/**
 * Catmull-Rom through every vertex, converted to the cubic béziers the `path` entity
 * stores. Chosen over a least-squares bézier fit because it passes exactly through the
 * points the user drew, needs no iteration, and is about fifteen lines.
 */
function toPath(points: readonly Pt[], closed: boolean): PathCommand[] {
  const commands: PathCommand[] = [["M", points[0]![0], points[0]![1]]]
  const at = (index: number): Pt => {
    if (closed) return points[(index + points.length) % points.length]!
    return points[Math.max(0, Math.min(points.length - 1, index))]!
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    commands.push([
      "C",
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    ])
  }
  if (closed) commands.push(["Z"])
  return commands
}

/** Axis-aligned box from a closed four-corner stroke. */
function toRect(points: readonly Pt[]): Entity {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { type: "rect", at: [minX, minY], w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
}

/** Circle through three points, used when the arc tool is explicitly chosen. */
function circleThrough(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | undefined {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-9) return undefined
  const aSq = a[0] ** 2 + a[1] ** 2
  const bSq = b[0] ** 2 + b[1] ** 2
  const cSq = c[0] ** 2 + c[1] ** 2
  const centre: Pt = [
    (aSq * (b[1] - c[1]) + bSq * (c[1] - a[1]) + cSq * (a[1] - b[1])) / d,
    (aSq * (c[0] - b[0]) + bSq * (a[0] - c[0]) + cSq * (b[0] - a[0])) / d,
  ]
  return { c: centre, r: dist(centre, a) }
}

const degrees = (from: Pt, to: Pt) => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI

function snapOne(point: Pt, options: Required<Pick<FitOptions, "snapGrid" | "snapRadius">> & { snapPoints?: readonly Pt[] }): Pt {
  // Existing endpoints win over the grid: joining two shapes exactly matters more than
  // sitting on a round number.
  let best: Pt | undefined
  let bestDistance = options.snapRadius
  for (const candidate of options.snapPoints ?? []) {
    const away = dist(point, candidate)
    if (away <= bestDistance) {
      best = candidate
      bestDistance = away
    }
  }
  if (best) return [best[0], best[1]]
  if (options.snapGrid > 0) {
    return [
      Math.round(point[0] / options.snapGrid) * options.snapGrid,
      Math.round(point[1] / options.snapGrid) * options.snapGrid,
    ]
  }
  return point
}

/** Applies snapping to whichever fields of an entity are actual positions. */
function snapEntity(entity: Entity, options: Parameters<typeof snapOne>[1]): Entity {
  const p = (point: Pt) => snapOne(point, options)
  switch (entity.type) {
    case "line":
      return { ...entity, a: p(entity.a), b: p(entity.b) }
    case "polyline":
      return { ...entity, pts: entity.pts.map(p) }
    case "rect": {
      const from = p(entity.at)
      const to = p([entity.at[0] + entity.w, entity.at[1] + entity.h])
      return { ...entity, at: from, w: to[0] - from[0], h: to[1] - from[1] }
    }
    case "circle":
      return { ...entity, c: p(entity.c) }
    case "arc":
      return { ...entity, c: p(entity.c) }
    case "path":
      // Only the endpoints; snapping control points would deform the curve.
      return {
        ...entity,
        d: entity.d.map((command, index) => {
          if (command[0] === "M") {
            const [x, y] = p([command[1], command[2]])
            return ["M", x, y]
          }
          if (command[0] === "C" && index === entity.d.length - 1) {
            const [x, y] = p([command[5], command[6]])
            return ["C", command[1], command[2], command[3], command[4], x, y]
          }
          return command
        }),
      }
    default:
      return entity
  }
}

/**
 * Turns a hand-drawn stroke into a single clean entity.
 *
 * The order matters: smooth first so RDP is not preserving tremor, simplify before
 * classifying so corner counting is meaningful, and snap last so a decision is never made
 * on coordinates that are about to move.
 *
 * Returns undefined for a stroke too short to be anything — a stray finger twitch.
 */
export function fitStroke(raw: readonly StrokePoint[], options: FitOptions = {}): Entity | undefined {
  const tolerance = options.tolerance ?? DEFAULT_FIT.tolerance
  const snap = {
    snapGrid: options.snapGrid ?? DEFAULT_FIT.snapGrid,
    snapRadius: options.snapRadius ?? DEFAULT_FIT.snapRadius,
    snapPoints: options.snapPoints,
  }
  const tool = options.tool ?? "auto"

  const smoothed = smooth(raw, options.smoothing ?? DEFAULT_FIT.smoothing)
  const thinned = thin(smoothed, tolerance * 0.5)
  if (thinned.length < 2) return undefined

  const span = Math.max(
    Math.max(...thinned.map((point) => point[0])) - Math.min(...thinned.map((point) => point[0])),
    Math.max(...thinned.map((point) => point[1])) - Math.min(...thinned.map((point) => point[1])),
  )
  if (span < tolerance) return undefined

  const points = simplify(thinned, tolerance)
  const closed = isClosed(thinned, span)
  const first = points[0]!
  const last = points.at(-1)!

  const finish = (entity: Entity) => snapEntity(entity, snap)

  if (tool === "line") return finish({ type: "line", a: first, b: last })
  if (tool === "rect") return finish(toRect(thinned))
  if (tool === "circle") {
    const { c, r } = circularity(thinned)
    return finish({ type: "circle", c, r: Math.max(r, tolerance) })
  }
  if (tool === "arc") {
    const middle = thinned[Math.floor(thinned.length / 2)]!
    const fitted = circleThrough(first, middle, last)
    if (!fitted) return finish({ type: "line", a: first, b: last })
    let a0 = degrees(fitted.c, first)
    let a1 = degrees(fitted.c, last)
    // Make the sweep go the way the stroke actually travelled, past the middle point.
    const mid = degrees(fitted.c, middle)
    const between = (value: number, from: number, to: number) =>
      ((value - from + 360) % 360) <= ((to - from + 360) % 360)
    if (!between(mid, a0, a1)) [a0, a1] = [a1, a0]
    if (a1 < a0) a1 += 360
    return finish({ type: "arc", c: fitted.c, r: Math.max(fitted.r, tolerance), a0, a1 })
  }
  if (tool === "polyline") return finish({ type: "polyline", pts: points, closed })
  if (tool === "path") return finish({ type: "path", d: toPath(points, closed) })

  // --- auto ---
  if (points.length === 2) return finish({ type: "line", a: first, b: last })

  if (closed) {
    const { c, r, spread } = circularity(thinned)
    // A hand-drawn circle keeps its radius to within about a tenth over the whole loop;
    // a rectangle does not, since its corners are √2 further out than its edges.
    if (spread < 0.12 && points.length >= 4) return finish({ type: "circle", c, r })

    // Anything filling most of its bounding box is a box. A circle would have been caught
    // above and fills only 0.79 anyway; a triangle or diamond fills about half.
    if (boxFill(thinned) > 0.82) return finish(toRect(thinned))
  }

  const sharp = points
    .slice(1, -1)
    .filter((_, index) => turn(points[index]!, points[index + 1]!, points[index + 2]!) > 40).length

  // No sharp corners over several vertices means the user drew a curve, not a chain of
  // straight segments — a polyline there would look faceted.
  if (sharp === 0 && points.length >= 4) return finish({ type: "path", d: toPath(points, closed) })

  return finish({ type: "polyline", pts: points, closed })
}
