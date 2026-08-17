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
