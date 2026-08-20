import { bbox, flatten } from "./geom.ts"
import type { BlueprintDoc, Entity, Pt } from "./schema.ts"

/**
 * Selection geometry, shared by the web canvas and the terminal editor. Both point at the
 * same drawing with a different input device, and "what did the user just click on" has
 * exactly one right answer — so it lives here rather than once per front-end.
 */

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Nice round grid step for the current zoom: 1, 2, 5, 10, 20, 50 … in document units. */
export function gridStep(unitsPerPixel: number): number {
  const target = unitsPerPixel * 48
  const magnitude = 10 ** Math.floor(Math.log10(target))
  for (const factor of [1, 2, 5]) {
    if (magnitude * factor >= target) return magnitude * factor
  }
  return magnitude * 10
}

/**
 * Nearest entity to a document-space point, within `tolerance` document units.
 *
 * Everything is measured against `flatten`, the same polyline approximation the renderers
 * draw — so what looks clickable is clickable, and arcs and béziers need no special case.
 */
export function hitTest(
  doc: BlueprintDoc,
  point: Pt,
  tolerance: number,
  skip?: (entity: Entity) => boolean,
): string | undefined {
  let best: { id: string; distance: number } | undefined
  // Last drawn is topmost, so walk backwards and let a tie go to the entity on top.
  for (let index = doc.entities.length - 1; index >= 0; index -= 1) {
    const entity = doc.entities[index]!
    if (skip?.(entity)) continue
    let distance = Infinity
    if (entity.type === "text") {
      distance = Math.hypot(entity.at[0] - point[0], entity.at[1] - point[1]) - (entity.size ?? 4)
    } else {
      for (const run of flatten(entity, tolerance / 2)) {
        for (let n = 1; n < run.length; n += 1) {
          distance = Math.min(distance, distanceToSegment(point, run[n - 1]!, run[n]!))
        }
        if (run.length === 1) distance = Math.min(distance, Math.hypot(run[0]![0] - point[0], run[0]![1] - point[1]))
      }
    }
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { id: entity.id!, distance }
    }
  }
  return best?.id
}

/** Ids whose bounding box falls entirely inside the rectangle — marquee selection. */
export function entitiesWithin(doc: BlueprintDoc, from: Pt, to: Pt): string[] {
  const x0 = Math.min(from[0], to[0])
  const x1 = Math.max(from[0], to[0])
  const y0 = Math.min(from[1], to[1])
  const y1 = Math.max(from[1], to[1])
  return doc.entities
    .filter((entity) => {
      const box = bbox([entity])
      return box !== undefined && box[0] >= x0 && box[1] >= y0 && box[2] <= x1 && box[3] <= y1
    })
    .map((entity) => entity.id!)
}
