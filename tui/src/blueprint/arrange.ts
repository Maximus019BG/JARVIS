import { bbox } from "./geom.ts"
import type { BlueprintDoc, Part, Pt } from "./schema.ts"
import { findSymbol, GRID } from "./symbols/index.ts"

/**
 * Tidying up after a rough placement, so the caller can drop parts approximately and still
 * end up with a drawing that reads: everything on the schematic grid, nothing overlapping
 * anything else.
 *
 * Returns the delta per part rather than a new document — the mover is `applyOps`, which
 * has to move the part's entities and its ports by the same amount, and splitting that
 * decision across two files is how the two drift apart.
 */

/** Clear space left between two parts, in document units. */
const GAP = GRID

const snap = (value: number) => Math.round(value / GRID) * GRID

type Box = [number, number, number, number]

const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

const shift = (box: Box, by: Pt): Box => [box[0] + by[0], box[1] + by[1], box[2] + by[0], box[3] + by[1]]

/** A part's footprint from the entities it owns, grown by half the gap on every side. */
function footprint(doc: BlueprintDoc, part: Part): Box | undefined {
  const box = bbox(doc.entities.filter((entity) => entity.id?.startsWith(`${part.prefix}-`)))
  return box ? [box[0] - GAP / 2, box[1] - GAP / 2, box[2] + GAP / 2, box[3] + GAP / 2] : undefined
}

/**
 * Where each named part should move to, keyed by ref. Parts already in the right place are
 * left out, so an `arrange` on a tidy drawing is a genuine no-op and commits nothing.
 *
 * Building symbols are never moved: a floor plan is drawn at real size in millimetres, and
 * a door snapped to a 2.54 mm schematic grid is a door in the wrong place.
 */
export function arrangeParts(doc: BlueprintDoc, refs?: readonly string[]): Map<string, Pt> {
  const wanted = refs ? new Set(refs.map((ref) => ref.toLowerCase())) : undefined
  const parts = (doc.parts ?? []).filter((part) => !wanted || wanted.has(part.ref.toLowerCase()))
  const moves = new Map<string, Pt>()

  // Boxes of everything, movable or not, so a part being arranged also avoids the ones
  // that are pinned.
  const boxes = new Map<string, Box>()
  for (const part of doc.parts ?? []) {
    const box = footprint(doc, part)
    if (box) boxes.set(part.ref, box)
  }

  for (const part of parts) {
    const movable = findSymbol(part.symbol)?.domain !== "building"
    let by: Pt = movable ? [snap(part.at[0]) - part.at[0], snap(part.at[1]) - part.at[1]] : [0, 0]
    const box = boxes.get(part.ref)

    if (box && movable) {
      // Nudge along whichever axis needs the least travel, a grid step at a time. A part
      // that has nowhere to go after a full sheet's worth of steps is left where it is —
      // better an overlap the user can see than one shoved off the sheet.
      let moved = shift(box, by)
      for (let step = 0; step < 64; step += 1) {
        const clash = [...boxes].find(([ref, other]) => ref !== part.ref && overlaps(moved, other))
        if (!clash) break
        const other = clash[1]
        const right = other[2] - moved[0]
        const left = moved[2] - other[0]
        const down = other[3] - moved[1]
        const up = moved[3] - other[1]
        const least = Math.min(right, left, down, up)
        const push: Pt =
          least === right ? [GRID, 0] : least === left ? [-GRID, 0] : least === down ? [0, GRID] : [0, -GRID]
        by = [by[0] + push[0], by[1] + push[1]]
        moved = shift(box, by)
      }
      boxes.set(part.ref, moved)
    }

    if (by[0] !== 0 || by[1] !== 0) moves.set(part.ref, by)
  }

  return moves
}
