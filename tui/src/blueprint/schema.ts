import { z } from "zod"

/**
 * A blueprint is an ordered list of entities in a physical coordinate space. Y grows
 * *downwards*, like SVG and every 2D canvas — a blueprint is drawn, not plotted, and
 * agreeing with the two renderers costs less than agreeing with CAD convention.
 */
export const UNITS = ["mm", "cm", "in", "px"] as const

export type Pt = [number, number]

const point = z.tuple([z.number(), z.number()])

/** Style is optional everywhere; the layer supplies the fallback. */
const style = {
  stroke: z.string().optional(),
  width: z.number().positive().optional(),
  dash: z.enum(["solid", "dashed", "dotted"]).optional(),
}

/**
 * `id` and `layer` are optional on the way in so a caller can add an entity without
 * inventing either — `applyOps` fills both before anything is stored. Files written by
 * hand without them load fine and get backfilled on the next save.
 */
const common = { id: z.string().optional(), layer: z.string().optional(), ...style }

const pathCommand = z.union([
  z.tuple([z.literal("M"), z.number(), z.number()]),
  z.tuple([z.literal("L"), z.number(), z.number()]),
  z.tuple([z.literal("Q"), z.number(), z.number(), z.number(), z.number()]),
  z.tuple([z.literal("C"), z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
  z.tuple([z.literal("Z")]),
])

export type PathCommand = z.infer<typeof pathCommand>

export const EntitySchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("line"), a: point, b: point }),
  z.object({ ...common, type: z.literal("polyline"), pts: z.array(point).min(2), closed: z.boolean().optional() }),
  z.object({
    ...common,
    type: z.literal("rect"),
    at: point,
    w: z.number(),
    h: z.number(),
    rx: z.number().nonnegative().optional(),
  }),
  z.object({ ...common, type: z.literal("circle"), c: point, r: z.number().positive() }),
  // Angles in degrees, measured clockwise from +X because Y points down. a0 -> a1 always
  // sweeps in increasing-angle order, so a1 < a0 means "the long way round".
  z.object({ ...common, type: z.literal("arc"), c: point, r: z.number().positive(), a0: z.number(), a1: z.number() }),
  z.object({ ...common, type: z.literal("path"), d: z.array(pathCommand).min(1) }),
  z.object({
    ...common,
    type: z.literal("text"),
    at: point,
    text: z.string(),
    size: z.number().positive().optional(),
    angle: z.number().optional(),
  }),
  // `offset` is the perpendicular distance from the a->b line to the dimension line.
  // Negative flips it to the other side.
  z.object({ ...common, type: z.literal("dimension"), a: point, b: point, offset: z.number(), label: z.string().optional() }),
])

export type Entity = z.infer<typeof EntitySchema>
export type EntityType = Entity["type"]

export const LayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
  visible: z.boolean().optional(),
})

export type Layer = z.infer<typeof LayerSchema>

/**
 * A placed symbol, remembered.
 *
 * The entities a symbol produces are ordinary geometry once placed — nothing about them
 * says "this arc and those two lines are one resistor", and the transformed port
 * coordinates used to be printed to the caller and then thrown away. That made connecting
 * two parts the caller's trigonometry problem and left the drawing with no record of what
 * was wired to what. A part is that record: the handle `connect` addresses, and the ports
 * it addresses them by.
 *
 * `ports` are stored already transformed into document space rather than recomputed from
 * the library on demand, so routing needs no symbol lookup and a symbol later renamed or
 * reshaped in the library cannot silently move the wires in a drawing already finished.
 */
export const PartSchema = z.object({
  /** Reference designator, unique in the document: `R1`, `U3`. Case-insensitive on lookup. */
  ref: z.string(),
  symbol: z.string(),
  at: point,
  rotate: z.number().optional(),
  scale: z.number().positive().optional(),
  /** Id prefix of every entity this placement produced, so the two stay in step. */
  prefix: z.string(),
  /** Connection points in document coordinates, in the library's documented order. */
  ports: z.array(point).default([]),
})

export type Part = z.infer<typeof PartSchema>

export const BlueprintDocSchema = z.object({
  schema: z.literal(1),
  id: z.string(),
  name: z.string(),
  units: z.enum(UNITS).default("mm"),
  /**
   * Highest entity number ever handed out. Kept in the file so ids are never reused: an
   * id must mean the same entity forever, or a diff reports a delete-plus-add as a
   * modification and a merge treats two unrelated entities as one.
   */
  seq: z.number().int().nonnegative().optional(),
  /** [minX, minY, width, height], same meaning as SVG's. */
  viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  layers: z.array(LayerSchema).min(1),
  entities: z.array(EntitySchema).default([]),
  /** Placed symbols. Additive and optional: a file written before parts existed loads fine. */
  parts: z.array(PartSchema).default([]),
})

export type BlueprintDoc = z.infer<typeof BlueprintDocSchema>

export class BlueprintError extends Error {}

/** A4 landscape in millimetres — a sane default sheet for a workbench drawing. */
export const DEFAULT_VIEW_BOX: [number, number, number, number] = [0, 0, 297, 210]

export function emptyDoc(name: string, viewBox = DEFAULT_VIEW_BOX, units: (typeof UNITS)[number] = "mm"): BlueprintDoc {
  return {
    schema: 1,
    id: `bp_${Math.random().toString(36).slice(2, 10)}`,
    name,
    units,
    seq: 0,
    viewBox,
    layers: [{ id: "l0", name: "outline", color: "#0f766e", visible: true }],
    entities: [],
    parts: [],
  }
}

/**
 * `e12` -> 12, so `nextId` keeps counting past merge-suffixed ids like `e12-b` without
 * ever handing out one that is already taken.
 */
function idNumber(id: string): number {
  const match = /^e(\d+)/.exec(id)
  return match ? Number(match[1]) : 0
}

/**
 * The counter to allocate the next id from: the stored `seq`, but never below the highest
 * id actually present, so a hand-edited file that added `e40` by hand cannot collide.
 */
export function seqOf(doc: { seq?: number; entities: readonly Entity[] }): number {
  return Math.max(doc.seq ?? 0, 0, ...doc.entities.map((entity) => idNumber(entity.id ?? "")))
}

/** Backfills ids and layers so a hand-written file round-trips cleanly. */
export function parseDoc(json: string): BlueprintDoc {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (error) {
    throw new BlueprintError(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const result = BlueprintDocSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join(".") || "<root>"}: ${issue.message}`)
    throw new BlueprintError(`invalid blueprint:\n${issues.join("\n")}`)
  }
  const doc = result.data
  const layer = doc.layers[0]!.id
  let counter = seqOf(doc)
  doc.entities = doc.entities.map((entity) => ({
    ...entity,
    id: entity.id ?? `e${++counter}`,
    layer: entity.layer ?? layer,
  }))
  // A file written before `seq` existed gets one here, so the guarantee starts holding
  // from the first save rather than the first id collision.
  doc.seq = counter
  return doc
}

/**
 * Float noise must never produce a git diff, so every number is rounded to 4 decimals
 * on the way out. `-0` is normalised too: it stringifies as `0` in JSON but compares
 * unequal, which would make round-trip tests lie.
 */
function round(value: number): number {
  const rounded = Math.round(value * 1e4) / 1e4
  return Object.is(rounded, -0) ? 0 : rounded
}

function clean(value: unknown): unknown {
  if (typeof value === "number") return round(value)
  if (Array.isArray(value)) return value.map(clean)
  return value
}

/**
 * Fixed key order across every entity type. Emitting keys in insertion order instead
 * would let two writers produce byte-different files for the same drawing, and the
 * whole version-control story rests on that not happening.
 */
const KEY_ORDER = [
  "id",
  "type",
  "layer",
  "a",
  "b",
  "c",
  "r",
  "a0",
  "a1",
  "at",
  "w",
  "h",
  "rx",
  "pts",
  "d",
  "closed",
  "text",
  "size",
  "angle",
  "offset",
  "label",
  "stroke",
  "width",
  "dash",
]

function inline(record: Record<string, unknown>, order: readonly string[]): string {
  const parts: string[] = []
  for (const key of order) {
    const value = record[key]
    if (value !== undefined) parts.push(`${JSON.stringify(key)}: ${JSON.stringify(clean(value))}`)
  }
  // Anything the order list does not know about still gets written — losing a field
  // silently would be worse than an out-of-order diff.
  for (const [key, value] of Object.entries(record)) {
    if (!order.includes(key) && value !== undefined) parts.push(`${JSON.stringify(key)}: ${JSON.stringify(clean(value))}`)
  }
  return `{ ${parts.join(", ")} }`
}

const LAYER_ORDER = ["id", "name", "color", "visible"]

const PART_ORDER = ["ref", "symbol", "prefix", "at", "rotate", "scale", "ports"]

/**
 * An entity's canonical form — the exact text `serialize` would write for it. Comparing
 * these is how diff and merge decide two entities are the same, so "changed" always means
 * the same thing as "produces a different line in the file".
 */
export function canonicalEntity(entity: Entity): string {
  return inline(entity, KEY_ORDER)
}

const block = (items: string[]): string =>
  items.length === 0 ? "[]" : `[\n${items.map((item) => `    ${item}`).join(",\n")}\n  ]`

/** One entity per line, stable key order, trailing newline. The only writer. */
export function serialize(doc: BlueprintDoc): string {
  return `${[
    "{",
    `  "schema": 1,`,
    `  "id": ${JSON.stringify(doc.id)},`,
    `  "name": ${JSON.stringify(doc.name)},`,
    `  "units": ${JSON.stringify(doc.units)},`,
    `  "seq": ${seqOf(doc)},`,
    `  "viewBox": ${JSON.stringify(doc.viewBox.map(round))},`,
    `  "layers": ${block(doc.layers.map((layer) => inline(layer, LAYER_ORDER)))},`,
    `  "entities": ${block(doc.entities.map((entity) => inline(entity, KEY_ORDER)))},`,
    // Not conditional on there being any: an array that appears and disappears would make
    // the first placement and the last deletion show up as structural diffs.
    `  "parts": ${block((doc.parts ?? []).map((part) => inline(part, PART_ORDER)))}`,
    "}",
  ].join("\n")}\n`
}
