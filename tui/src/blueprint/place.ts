import { apply, compose, rotate, scale, transform, type Mat } from "./geom.ts"
import type { Op } from "./ops.ts"
import { translate } from "./geom.ts"
import type { Entity, Part, Pt } from "./schema.ts"
import { findSymbol, GRID } from "./symbols/index.ts"

/**
 * Placing a symbol, once, for everybody: the agent's `blueprint_symbol`, the web symbol
 * palette and the terminal editor all come through here, so a resistor dropped by any of
 * them produces byte-identical geometry and the same `parts` record.
 *
 * Deliberately free of any Bun or filesystem import — `web/` compiles this file directly
 * through its `@blueprint/*` alias, and the moment it reaches `store.ts` that stops working.
 */

export type Placement = {
  symbol: string
  at: Pt
  rotate?: number
  scale?: number
  layer?: string
  /** Reference to draw beside it and to build ids from, e.g. "R1". */
  label?: string
  labelOffset?: Pt
}

export type Placed = { ops: Op[]; part: Part }

/**
 * The reference designator inside a label.
 *
 * A label is drawn on the sheet, and the sheet's convention — the one `check.ts` reads — is
 * `REF | key=value, key=value`, so `"U1 | mA=240, V=3.3"` is a perfectly ordinary label. The
 * part is addressed by `U1`, not by the whole annotated string, or the annotation that makes
 * a drawing checkable would be the thing that makes it unwireable.
 */
export const refIn = (label: string): string => (label.split("|")[0] ?? label).trim()

/**
 * Ids get a per-placement prefix so a symbol's parts move as a unit later. `e` is
 * excluded deliberately: `seqOf` parses `^e(\d+)` to find the next free id, so a symbol
 * called `e5-a` would poison the counter and the next `add` would collide.
 */
export function prefixFor(label: string | undefined, symbol: string, index: number): string {
  const base = (label ?? symbol.replace(/^[a-z]+\//, "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const safe = base.replace(/^e(?=\d)/, "x") || "sym"
  return `${safe}-${index}`
}

/**
 * Schematic symbols live on the 0.1" grid because that is the pitch of every pin header
 * and DIP package; a wire between two ports that are both on it stays orthogonal and
 * lands where a person expects. Building symbols are drawn at real size in millimetres
 * and must not be nudged — a door is where the wall is, not where the grid is.
 */
export function snapAt(at: Pt, domain: string): Pt {
  if (domain === "building") return at
  return [Math.round(at[0] / GRID) * GRID, Math.round(at[1] / GRID) * GRID]
}

/**
 * The ops for one placement plus the part record to remember it by, or undefined when the
 * symbol name matches nothing. `index` only disambiguates the id prefix within a batch.
 */
export function placeSymbol(placement: Placement, index: number): Placed | undefined {
  const found = findSymbol(placement.symbol)
  if (!found) return undefined
  const { symbol, domain } = found

  const at = snapAt(placement.at, domain)
  const spin = placement.rotate ?? 0
  const size = placement.scale ?? 1
  // Scale, then rotate, then translate: `compose(a, b)` applies b first, so the symbol is
  // shaped and turned about its own origin before it is moved into place.
  const matrix: Mat = compose(translate(at[0], at[1]), compose(rotate(spin), scale(size, size)))

  const ref = placement.label ? refIn(placement.label) : undefined
  const prefix = prefixFor(ref, placement.symbol, index + 1)
  const layer = placement.layer
  const ops: Op[] = symbol.entities.map((source, n) => ({
    op: "add",
    entity: { ...(transform(source, matrix) as Entity), id: `${prefix}-${n}`, ...(layer ? { layer } : {}) },
  }))

  if (placement.label) {
    const [dx, dy] = placement.labelOffset ?? [0, -6 * size]
    ops.push({
      op: "add",
      entity: {
        type: "text",
        at: [at[0] + dx, at[1] + dy],
        text: placement.label,
        size: 2.5 * size,
        id: `${prefix}-label`,
        ...(layer ? { layer } : {}),
      },
    })
  }

  const part: Part = {
    ref: ref || prefix,
    symbol: placement.symbol,
    at,
    ...(spin ? { rotate: spin } : {}),
    ...(size !== 1 ? { scale: size } : {}),
    prefix,
    ports: (symbol.ports ?? []).map((port) => apply(matrix, port)),
  }

  return { ops, part }
}
