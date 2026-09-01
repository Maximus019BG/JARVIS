import { bbox } from "../geom.ts"
import type { Entity, Pt } from "../schema.ts"
import { BUILDING } from "./building.ts"
import { ELECTRICAL } from "./electrical.ts"
import { IOT } from "./iot.ts"

/**
 * A reusable piece of drawing, in its own coordinates. Placing one transforms every
 * entity by the same matrix and hands the result to `applyOps`, so a symbol is data —
 * there is no second drawing engine here, only a library of shapes for the one that
 * already exists.
 *
 * Named `BlueprintSymbol` because `Symbol` is a global.
 */
export type BlueprintSymbol = {
  describe: string
  /** The clause this shape comes from, when it comes from one. */
  standard?: string
  /**
   * Entities in local coordinates, origin at the insertion point. `id` and `layer` are
   * left off deliberately: both are assigned when the symbol is placed.
   */
  entities: Entity[]
  /**
   * Connection points in local coordinates, in a documented order. The placement tool
   * returns these transformed, so wiring up a rotated part needs no trigonometry.
   */
  ports?: Pt[]
  /**
   * Pin names, positionally matched to `ports`. Optional per symbol and `""` per pin, so a
   * resistor stays two anonymous ends while an ESP32 says which one is `3V3`.
   *
   * Only worth declaring where the name changes what a wire should do — polarity, supply,
   * bus signals. A symmetrical two-terminal part has nothing to say here.
   */
  pins?: string[]
}

/** Which end of a supply a pin belongs to, as far as automatic wiring is concerned. */
export type PinRole = "+" | "-" | "signal"

const PLUS = /^(\+|v\+|vcc|vdd|vin|vbat|vbus|3v3|3\.3v|5v|12v|24v|\+v|b\+|anode)$/
const MINUS = /^(-|−|v-|vss|vee|gnd|ground|com|earth|0v|-v|b-|cathode)$/

/**
 * A pin's supply role, from its name alone.
 *
 * A table, deliberately: the alternative to matching `"3V3"` against a list is asking
 * something to infer it, and a rail that is positive only most of the time is worse than no
 * automatic wiring at all. Anything unrecognised is a signal, which is the safe answer —
 * signals are never wired automatically by role.
 */
export function roleOf(pin: string | undefined): PinRole {
  const name = (pin ?? "").trim().toLowerCase()
  if (!name) return "signal"
  // Board pins arrive as `"VIN 5V"` or `"GPIO21 SDA"`: the leading token is the pin proper
  // and the rest is the annotation drawn beside it.
  const head = name.split(/[\s/]+/)[0] ?? name
  if (PLUS.test(head) || PLUS.test(name)) return "+"
  if (MINUS.test(head) || MINUS.test(name)) return "-"
  return "signal"
}

/**
 * The outward direction of each port: the way a wire has to leave it to look like someone
 * drew it, rather than like a line that happens to end there.
 *
 * Derived from the shape instead of declared on it. Every symbol in the library puts its
 * ports on leads that stick out of a body, so "which side of my own bounding box am I
 * nearest" recovers the answer for all of them and cannot fall out of step with the drawing
 * the way 164 hand-written direction vectors would. A port at the centre of its own box —
 * a junction dot, a single-point marker — has no outward side and reports [0, 0], which
 * every caller reads as "no preference".
 */
export function portDirs(symbol: BlueprintSymbol): Pt[] {
  const ports = symbol.ports ?? []
  if (ports.length === 0) return []
  const box = bbox(symbol.entities)
  if (!box) return ports.map(() => [0, 0] as Pt)
  const [x0, y0, x1, y1] = box
  const spanX = x1 - x0
  const spanY = y1 - y0
  return ports.map(([x, y]) => {
    // Each side: how far the port is from it, the shape's extent along that axis, and the
    // way out. An axis the shape is flat along is no way out at all — a symbol drawn as one
    // horizontal line has zero height, and "above" is not a side of it.
    const sides: { gap: number; span: number; out: Pt }[] = [
      { gap: x - x0, span: spanX, out: [-1, 0] },
      { gap: x1 - x, span: spanX, out: [1, 0] },
      { gap: y - y0, span: spanY, out: [0, -1] },
      { gap: y1 - y, span: spanY, out: [0, 1] },
    ]
    // A port on a lead sits *on* the boundary, so its gap is ~0; a port at the middle of the
    // shape sits half the extent from every side. Comparing the gap to the extent rather
    // than to an absolute distance is what keeps this right for both a 52 mm board and a
    // 1.6 mm junction dot, whose tessellated circle is not even exactly square.
    const edges = sides.filter((side) => side.span > 0 && side.gap * 4 < side.span)
    if (edges.length === 0) return [0, 0] as Pt
    return edges.reduce((best, side) => (side.gap < best.gap ? side : best)).out
  })
}

export type SymbolLibrary = Record<string, BlueprintSymbol>

export const DOMAINS = ["electrical", "building", "iot"] as const
export type SymbolDomain = (typeof DOMAINS)[number]

export const LIBRARIES: Record<SymbolDomain, SymbolLibrary> = {
  electrical: ELECTRICAL,
  building: BUILDING,
  iot: IOT,
}

/**
 * Schematic grid. 2.54 mm is 0.1 inch, which is the pitch of every pin header, DIP
 * package and breadboard row on earth — schematic and wiring symbols land on it so a
 * drawing lines up with the hardware instead of merely looking like it does.
 *
 * Building symbols ignore this: a floor plan is drawn at real size in millimetres.
 */
export const GRID = 2.54

/** Every symbol, `domain/name` keyed, for lookup without knowing which library it is in. */
export function findSymbol(name: string): { domain: SymbolDomain; symbol: BlueprintSymbol } | undefined {
  const slash = name.indexOf("/")
  if (slash !== -1) {
    const domain = name.slice(0, slash) as SymbolDomain
    const symbol = LIBRARIES[domain]?.[name.slice(slash + 1)]
    return symbol ? { domain, symbol } : undefined
  }
  // Bare names are allowed because most are unique; the first library that has one wins,
  // and `blueprint_symbol action:"list"` shows the qualified name for the ambiguous few.
  for (const domain of DOMAINS) {
    const symbol = LIBRARIES[domain]![name]
    if (symbol) return { domain, symbol }
  }
  return undefined
}

/** Names matching a free-text query, qualified, for the `list` action. */
export function searchSymbols(options: { domain?: SymbolDomain; query?: string } = {}) {
  const needle = options.query?.toLowerCase().trim()
  const domains = options.domain ? [options.domain] : DOMAINS
  const found: { name: string; symbol: BlueprintSymbol }[] = []
  for (const domain of domains) {
    for (const [name, symbol] of Object.entries(LIBRARIES[domain]!)) {
      const haystack = `${domain}/${name} ${symbol.describe} ${symbol.standard ?? ""}`.toLowerCase()
      // Every whitespace-separated term must appear, so "3 phase motor" narrows rather
      // than widening the way an any-term match would.
      if (needle && !needle.split(/\s+/).every((term) => haystack.includes(term))) continue
      found.push({ name: `${domain}/${name}`, symbol })
    }
  }
  return found
}
