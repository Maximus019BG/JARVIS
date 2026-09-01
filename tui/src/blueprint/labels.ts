import { bbox, textBox } from "./geom.ts"
import type { Op } from "./ops.ts"
import type { BlueprintDoc, Entity, Part, Pt } from "./schema.ts"
import { GRID } from "./symbols/index.ts"

/**
 * Keeping reference designators off the geometry they designate.
 *
 * A label used to be drawn at a fixed offset above its part's insertion point and left
 * there. That is fine on an empty sheet and wrong on a full one: two parts a grid step apart
 * put their labels in the same place, and a label six units above a 52 mm tall board lands
 * inside the board. Nothing noticed, because until `bbox` learned that text has area a label
 * was a zero-area point and a point cannot collide with anything.
 *
 * The rule is the same shape as the router's: a fixed, ordered list of the places a person
 * would try, and the first one that is clear wins. Deterministic, so the same drawing always
 * labels the same way, and idempotent, so a label already in a clear spot never moves.
 */

type Box = [number, number, number, number]

/** Clear space required between a label and whatever it is avoiding. */
const MARGIN = GRID / 2

const hits = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

const grow = (box: Box, by: number): Box => [box[0] - by, box[1] - by, box[2] + by, box[3] + by]

/** A part's own geometry, not counting the label being placed. */
function footprint(doc: BlueprintDoc, part: Part): Box | undefined {
  return bbox(
    doc.entities.filter((entity) => entity.id?.startsWith(`${part.prefix}-`) && entity.id !== `${part.prefix}-label`),
  )
}

/**
 * Where to anchor a text entity so its box lands with this top-left corner. `at` is the
 * baseline-left point both renderers draw from, so the anchor sits an ascent below the top.
 */
const anchorFor = ([x, y]: Pt, size: number): Pt => [x, y + size * 0.75]

/**
 * The places to try, in order, for a label of this size beside this part.
 *
 * Above first because that is where a schematic puts a designator, then below, then the
 * sides, then the corners — and each ring one step further out than the last, so a crowded
 * corner of the sheet degrades into "a bit further away" rather than into "somewhere random".
 */
function candidates(box: Box, w: number, h: number, size: number): Pt[] {
  const [x0, y0, x1, y1] = box
  const cx = (x0 + x1) / 2 - w / 2
  const cy = (y0 + y1) / 2 - h / 2
  const out: Pt[] = []
  for (let ring = 1; ring <= 3; ring += 1) {
    const gap = MARGIN + (ring - 1) * GRID
    const above = y0 - gap - h
    const below = y1 + gap
    const left = x0 - gap - w
    const right = x1 + gap
    for (const corner of [
      [cx, above],
      [cx, below],
      [right, cy],
      [left, cy],
      [right, above],
      [left, above],
      [right, below],
      [left, below],
    ] as Pt[]) {
      out.push(anchorFor(corner, size))
    }
  }
  return out
}

/**
 * Ops that move part labels out of collision with parts, wires and each other.
 *
 * Labels are settled in a fixed order and each one sees the ones already settled, so the
 * result does not depend on the order the parts happened to be placed in.
 */
export function placeLabelOps(doc: BlueprintDoc): Op[] {
  const parts = [...(doc.parts ?? [])].sort((a, b) => a.prefix.localeCompare(b.prefix))
  const partBoxes = parts
    .map((part) => footprint(doc, part))
    .filter((box): box is Box => box !== undefined)
    .map((box) => grow(box, MARGIN))
  // Wire runs, as thin boxes — a label crossing a conductor is as unreadable as one sitting
  // on a symbol.
  const wireBoxes: Box[] = []
  for (const entity of doc.entities) {
    if (entity.type !== "polyline" || !/^w\d+$/.test(entity.id ?? "")) continue
    for (let i = 1; i < entity.pts.length; i += 1) {
      const a = entity.pts[i - 1]!
      const b = entity.pts[i]!
      wireBoxes.push(
        grow([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], MARGIN / 2),
      )
    }
  }

  const taken: Box[] = []
  const ops: Op[] = []
  for (const part of parts) {
    const label = doc.entities.find(
      (entity): entity is Extract<Entity, { type: "text" }> =>
        entity.id === `${part.prefix}-label` && entity.type === "text",
    )
    const own = footprint(doc, part)
    if (!label || !own) continue
    const size = label.size ?? 4
    const current = textBox(label)
    const w = current[2] - current[0]
    const h = current[3] - current[1]
    // Its own part is not an obstacle to itself only in the sense that it must still clear
    // it — every part box is in the list, including this one.
    const blockers = [...partBoxes, ...wireBoxes, ...taken]
    const clear = (box: Box) => !blockers.some((other) => hits(box, other))

    if (clear(current)) {
      taken.push(current)
      continue
    }
    const found = candidates(own, w, h, size).find((at) => clear([at[0], at[1] - size * 0.75, at[0] + w, at[1] + size * 0.25]))
    // Nowhere is clear: leave it where it is rather than shuffle it somewhere no better.
    // The checker reports the overlap, which is more use than a label that moved and still
    // collides.
    if (!found) {
      taken.push(current)
      continue
    }
    taken.push([found[0], found[1] - size * 0.75, found[0] + w, found[1] + size * 0.25])
    ops.push({ op: "update", id: label.id!, patch: { at: found } })
  }
  return ops
}
