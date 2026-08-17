import type { Entity, Pt } from "./schema.ts"

/** SVG's matrix order: [a, b, c, d, e, f] maps (x,y) to (ax+cy+e, bx+dy+f). */
export type Mat = [number, number, number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

export const translate = (dx: number, dy: number): Mat => [1, 0, 0, 1, dx, dy]

export function rotate(deg: number, about: Pt = [0, 0]): Mat {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const [cx, cy] = about
  return [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos]
}

export function scale(sx: number, sy: number, about: Pt = [0, 0]): Mat {
  const [cx, cy] = about
  return [sx, 0, 0, sy, cx - cx * sx, cy - cy * sy]
}

export const apply = (m: Mat, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** `compose(a, b)` applies b first, then a. */
export function compose(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1])

/**
 * How many straight segments a curve of this radius needs so its sagitta stays under
 * `tol`. The exact form is `sweep / (2 * acos(1 - tol/r))`; the clamp keeps a hairline
 * circle from costing 4000 points and a huge one from looking like a hexagon.
 */
function arcSegments(radius: number, sweepRad: number, tol: number): number {
  if (radius <= tol) return 4
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / radius))
  return Math.min(512, Math.max(6, Math.ceil(Math.abs(sweepRad) / step)))
}

function arcPoints(c: Pt, r: number, a0: number, a1: number, tol: number): Pt[] {
  const start = (a0 * Math.PI) / 180
  const sweep = ((a1 - a0) * Math.PI) / 180
  const n = arcSegments(r, sweep, tol)
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const angle = start + (sweep * i) / n
    pts.push([c[0] + r * Math.cos(angle), c[1] + r * Math.sin(angle)])
  }
  return pts
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number): Pt[] {
  // Control-polygon length is a cheap upper bound on arc length — good enough to pick a
  // segment count without a real adaptive subdivision.
  const rough = dist(p0, p1) + dist(p1, p2) + dist(p2, p3)
  const n = Math.min(128, Math.max(4, Math.ceil(rough / Math.max(tol * 6, 1e-6))))
  const pts: Pt[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return pts
}

const quadToCubic = (p0: Pt, q: Pt, p: Pt): [Pt, Pt] => [
  [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
  [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])],
]

/** Arrow barbs for a dimension line, as a small open polyline at `tip`. */
function barb(tip: Pt, towards: Pt, size: number): Pt[] {
  const angle = Math.atan2(towards[1] - tip[1], towards[0] - tip[0])
  const spread = 0.35
  return [
    [tip[0] + size * Math.cos(angle - spread), tip[1] + size * Math.sin(angle - spread)],
    tip,
    [tip[0] + size * Math.cos(angle + spread), tip[1] + size * Math.sin(angle + spread)],
  ]
}

/**
 * Every entity reduced to polylines, which is all any renderer actually needs. Closed
 * shapes repeat their first point at the end so a caller never has to know which is
 * which. `text` contributes no geometry — renderers draw its glyphs themselves.
 */
export function flatten(entity: Entity, tol = 0.2): Pt[][] {
  switch (entity.type) {
    case "line":
      return [[entity.a, entity.b]]
    case "polyline":
      return [entity.closed ? [...entity.pts, entity.pts[0]!] : entity.pts]
    case "rect": {
      const [x, y] = entity.at
      const { w, h } = entity
      const r = Math.min(entity.rx ?? 0, Math.abs(w) / 2, Math.abs(h) / 2)
      if (r <= 0) {
        return [
          [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
            [x, y],
          ],
        ]
      }
      // Corner arcs run clockwise in screen space because Y points down.
      return [
        [
          [x + r, y],
          [x + w - r, y],
          ...arcPoints([x + w - r, y + r], r, -90, 0, tol),
          [x + w, y + h - r],
          ...arcPoints([x + w - r, y + h - r], r, 0, 90, tol),
          [x + r, y + h],
          ...arcPoints([x + r, y + h - r], r, 90, 180, tol),
          [x, y + r],
          ...arcPoints([x + r, y + r], r, 180, 270, tol),
        ],
      ]
    }
    case "circle":
      return [arcPoints(entity.c, entity.r, 0, 360, tol)]
    case "arc":
      return [arcPoints(entity.c, entity.r, entity.a0, entity.a1, tol)]
    case "path": {
      const runs: Pt[][] = []
      let current: Pt[] = []
      let cursor: Pt = [0, 0]
      let start: Pt = [0, 0]
      for (const command of entity.d) {
        if (command[0] === "M") {
          if (current.length > 1) runs.push(current)
          cursor = [command[1], command[2]]
          start = cursor
          current = [cursor]
        } else if (command[0] === "L") {
          cursor = [command[1], command[2]]
          current.push(cursor)
        } else if (command[0] === "Q") {
          const end: Pt = [command[3], command[4]]
          const [c1, c2] = quadToCubic(cursor, [command[1], command[2]], end)
          current.push(...cubic(cursor, c1, c2, end, tol))
          cursor = end
        } else if (command[0] === "C") {
          const end: Pt = [command[5], command[6]]
          current.push(...cubic(cursor, [command[1], command[2]], [command[3], command[4]], end, tol))
          cursor = end
        } else {
          current.push(start)
          cursor = start
        }
      }
      if (current.length > 1) runs.push(current)
      return runs
    }
    case "dimension": {
      const { a, b, offset } = entity
      const length = dist(a, b)
      if (length === 0) return []
      const nx = -(b[1] - a[1]) / length
      const ny = (b[0] - a[0]) / length
      const from: Pt = [a[0] + nx * offset, a[1] + ny * offset]
      const to: Pt = [b[0] + nx * offset, b[1] + ny * offset]
      const overshoot = offset === 0 ? 0 : Math.sign(offset) * Math.min(2, Math.abs(offset) * 0.2)
      const size = Math.min(2.5, length / 6)
      return [
        [a, [from[0] + nx * overshoot, from[1] + ny * overshoot]],
        [b, [to[0] + nx * overshoot, to[1] + ny * overshoot]],
        [from, to],
        barb(from, to, size),
        barb(to, from, size),
      ]
    }
    case "text":
      return []
  }
}

/** [minX, minY, maxX, maxY], or undefined when nothing has geometry. */
export function bbox(entities: readonly Entity[], tol = 0.2): [number, number, number, number] | undefined {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const entity of entities) {
    // Text has no flattened geometry but still occupies the sheet; its anchor is the
    // best cheap approximation, and leaving it out entirely would let a label sit
    // outside a fitted view.
    const pts = entity.type === "text" ? [entity.at] : flatten(entity, tol).flat()
    for (const [x, y] of pts) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : undefined
}

/**
 * Moves an entity through a matrix. Radii scale by the mean of |sx| and |sy|: a circle
 * under a non-uniform scale is really an ellipse, which this format has no entity for.
 * ponytail: add an `ellipse` entity if non-uniform scaling ever becomes a real workflow.
 */
export function transform(entity: Entity, m: Mat): Entity {
  const p = (pt: Pt) => apply(m, pt)
  const radiusScale = (Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3])) / 2
  // Rotation and skew show up as non-zero off-diagonals. A rect is axis-aligned by
  // definition, so under either it has to stop being a rect — see the `rect` case.
  const skews = m[1] !== 0 || m[2] !== 0
  const spin = (Math.atan2(m[1], m[0]) * 180) / Math.PI
  switch (entity.type) {
    case "line":
      return { ...entity, a: p(entity.a), b: p(entity.b) }
    case "polyline":
      return { ...entity, pts: entity.pts.map(p) }
    case "rect": {
      if (skews) {
        // Keeping it a rect would silently square it back up to the axes and throw the
        // rotation away — a 45° square would collapse to a zero-width sliver. Becoming a
        // closed polyline is exact for square corners and a fine tessellation for round ones.
        const [outline] = flatten(entity)
        const { at: _at, w: _w, h: _h, rx: _rx, type: _type, ...rest } = entity
        return { ...rest, type: "polyline", pts: (outline ?? []).map(p), closed: true }
      }
      const corner = p(entity.at)
      const far = p([entity.at[0] + entity.w, entity.at[1] + entity.h])
      return {
        ...entity,
        at: corner,
        w: far[0] - corner[0],
        h: far[1] - corner[1],
        rx: entity.rx === undefined ? undefined : entity.rx * radiusScale,
      }
    }
    case "circle":
      return { ...entity, c: p(entity.c), r: entity.r * radiusScale }
    case "arc":
      // Recovering the rotation from where the +X axis lands keeps `rotate` working
      // without threading the angle through separately.
      return { ...entity, c: p(entity.c), r: entity.r * radiusScale, a0: entity.a0 + spin, a1: entity.a1 + spin }
    case "path":
      return {
        ...entity,
        d: entity.d.map((command) => {
          if (command[0] === "Z") return command
          if (command[0] === "M" || command[0] === "L") {
            const [x, y] = p([command[1], command[2]])
            return [command[0], x, y]
          }
          if (command[0] === "Q") {
            const [x1, y1] = p([command[1], command[2]])
            const [x, y] = p([command[3], command[4]])
            return ["Q", x1, y1, x, y]
          }
          const [x1, y1] = p([command[1], command[2]])
          const [x2, y2] = p([command[3], command[4]])
          const [x, y] = p([command[5], command[6]])
          return ["C", x1, y1, x2, y2, x, y]
        }),
      }
    case "text":
      // Glyphs turn with the drawing, or a rotated part ends up with a label lying flat.
      return {
        ...entity,
        at: p(entity.at),
        size: (entity.size ?? 4) * radiusScale,
        angle: skews ? (entity.angle ?? 0) + spin : entity.angle,
      }
    case "dimension":
      return { ...entity, a: p(entity.a), b: p(entity.b), offset: entity.offset * radiusScale }
  }
}
