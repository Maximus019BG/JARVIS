import { z } from "zod"
import { bbox, compose, rotate, scale, transform, translate, type Mat } from "./geom.ts"
import {
  BlueprintError,
  EntitySchema,
  LayerSchema,
  seqOf,
  type BlueprintDoc,
  type Entity,
  type Pt,
} from "./schema.ts"

const point = z.tuple([z.number(), z.number()])
const ids = z.array(z.string()).min(1).describe("Entity ids to act on")

/**
 * Every field any entity type can carry, all optional. `type` is deliberately absent:
 * changing an entity's kind in place would silently strip the fields the old kind owned,
 * so that is a delete plus an add.
 */
const PatchSchema = z.object({
  layer: z.string().optional(),
  a: point.optional(),
  b: point.optional(),
  c: point.optional(),
  r: z.number().positive().optional(),
  a0: z.number().optional(),
  a1: z.number().optional(),
  at: point.optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  rx: z.number().nonnegative().optional(),
  pts: z.array(point).min(2).optional(),
  closed: z.boolean().optional(),
  text: z.string().optional(),
  size: z.number().positive().optional(),
  angle: z.number().optional(),
  offset: z.number().optional(),
  label: z.string().optional(),
  stroke: z.string().optional(),
  width: z.number().positive().optional(),
  dash: z.enum(["solid", "dashed", "dotted"]).optional(),
})

/**
 * The `add` payload as the model sees it: `type` plus every entity field, all optional.
 * `EntitySchema` is an eight-variant union, and nesting it inside this ten-variant one gave
 * `blueprint_edit` a 7.6 KB input schema seventeen levels deep — two unions a model has to
 * pick through in one call, which mid-sized models miss and Groq turns into a hard
 * `failed_generation`. Flat here, narrowed by `EntitySchema.safeParse` in `applyOps`, so
 * nothing downstream ever sees an entity that has not been validated. Same trade the symbol
 * tool already makes for its `placements` array.
 */
const FlatEntitySchema = PatchSchema.extend({
  type: z.enum(["line", "polyline", "rect", "circle", "arc", "path", "text", "dimension"]),
  id: z.string().optional(),
  /** `pathCommand` is a five-variant union of differently shaped tuples — the deepest thing
   *  in the whole schema, and the reason this one field is loose rather than typed here. */
  d: z.array(z.array(z.union([z.string(), z.number()]))).min(1).optional(),
})

export const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), entity: FlatEntitySchema }),
  z.object({ op: z.literal("update"), id: z.string(), patch: PatchSchema }),
  z.object({ op: z.literal("delete"), ids }),
  z.object({ op: z.literal("move"), ids, by: point.describe("[dx, dy]") }),
  z.object({ op: z.literal("rotate"), ids, deg: z.number(), about: point.optional() }),
  z.object({ op: z.literal("scale"), ids, by: z.number(), about: point.optional() }),
  z.object({
    op: z.literal("restyle"),
    ids,
    stroke: z.string().optional(),
    width: z.number().positive().optional(),
    dash: z.enum(["solid", "dashed", "dotted"]).optional(),
    layer: z.string().optional(),
  }),
  z.object({ op: z.literal("addLayer"), layer: LayerSchema.partial({ id: true }) }),
  z.object({ op: z.literal("setLayer"), id: z.string(), patch: LayerSchema.partial().omit({ id: true }) }),
  z.object({ op: z.literal("setView"), viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
])

export type Op = z.infer<typeof OpSchema>

/** Centre of the selection, used when a rotate or scale gives no explicit pivot. */
function pivot(doc: BlueprintDoc, selected: Set<string>): Pt {
  const box = bbox(doc.entities.filter((entity) => selected.has(entity.id!)))
  return box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : [0, 0]
}

function mapSelected(doc: BlueprintDoc, selected: Set<string>, fn: (entity: Entity) => Entity): Entity[] {
  const seen = new Set<string>()
  const next = doc.entities.map((entity) => {
    if (!selected.has(entity.id!)) return entity
    seen.add(entity.id!)
    return fn(entity)
  })
  const missing = [...selected].filter((id) => !seen.has(id))
  if (missing.length > 0) throw new BlueprintError(`no such entity: ${missing.join(", ")}`)
  return next
}

const applyMat = (doc: BlueprintDoc, selected: Set<string>, m: Mat) =>
  mapSelected(doc, selected, (entity) => ({ ...transform(entity, m), id: entity.id, layer: entity.layer }))

/** Human-readable tally, used as the commit message when the caller supplies none. */
function describe(counts: Map<string, number>): string {
  if (counts.size === 0) return "no changes"
  return [...counts.entries()].map(([what, n]) => (n > 1 ? `${what} ×${n}` : what)).join(", ")
}

export type OpResult = { doc: BlueprintDoc; summary: string }

/**
 * Applies ops in order and returns a new document — the input is never mutated, so a
 * failure halfway through leaves the caller's copy intact and nothing partial reaches
 * disk. An unknown entity or layer id is an error, not a silent no-op: a drawing that
 * quietly ignored half its instructions is worse than one that refused them.
 */
export function applyOps(doc: BlueprintDoc, ops: readonly Op[]): OpResult {
  let next: BlueprintDoc = { ...doc, layers: [...doc.layers], entities: [...doc.entities] }
  const counts = new Map<string, number>()
  const bump = (what: string, n = 1) => counts.set(what, (counts.get(what) ?? 0) + n)
  // Allocated from, never recomputed from the entity list — deleting the highest-numbered
  // entity must not free its id for the next `add`.
  let seq = seqOf(next)

  for (const op of ops) {
    switch (op.op) {
      case "add": {
        // Narrow the flat payload to a real entity here — the same safeParse `update` runs
        // below, and the only place it happens for `add`.
        const parsed = EntitySchema.safeParse(op.entity)
        if (!parsed.success) {
          throw new BlueprintError(`invalid ${op.entity.type}: ${parsed.error.issues[0]?.message ?? "unknown"}`)
        }
        const entity = parsed.data
        const layer = entity.layer ?? next.layers[0]!.id
        if (!next.layers.some((existing) => existing.id === layer)) {
          throw new BlueprintError(`no such layer: ${layer}`)
        }
        // An explicit id is how a caller stamps a symbol and then moves the whole of it in
        // the same batch. `diff` and `merge3` key on id, so a repeat would not collide
        // loudly — it would quietly lose one of the two entities in a three-way merge.
        if (entity.id && next.entities.some((existing) => existing.id === entity.id)) {
          throw new BlueprintError(`entity id already taken: ${entity.id}`)
        }
        next.entities = [...next.entities, { ...entity, id: entity.id ?? `e${++seq}`, layer }]
        bump(`add ${entity.type}`)
        break
      }
      case "update": {
        const merged = mapSelected(next, new Set([op.id]), (entity) => {
          const candidate = { ...entity, ...op.patch }
          const result = EntitySchema.safeParse(candidate)
          if (!result.success) {
            throw new BlueprintError(
              `${op.id}: invalid ${entity.type} after patch — ${result.error.issues[0]?.message ?? "unknown"}`,
            )
          }
          return result.data
        })
        next.entities = merged
        bump("update")
        break
      }
      case "delete": {
        const selected = new Set(op.ids)
        const kept = next.entities.filter((entity) => !selected.has(entity.id!))
        const removed = next.entities.length - kept.length
        if (removed !== selected.size) {
          const present = new Set(next.entities.map((entity) => entity.id))
          throw new BlueprintError(`no such entity: ${op.ids.filter((id) => !present.has(id)).join(", ")}`)
        }
        next.entities = kept
        bump("delete", removed)
        break
      }
      case "move":
        next.entities = applyMat(next, new Set(op.ids), translate(op.by[0], op.by[1]))
        bump("move", op.ids.length)
        break
      case "rotate": {
        const selected = new Set(op.ids)
        next.entities = applyMat(next, selected, rotate(op.deg, op.about ?? pivot(next, selected)))
        bump("rotate", op.ids.length)
        break
      }
      case "scale": {
        const selected = new Set(op.ids)
        next.entities = applyMat(next, selected, scale(op.by, op.by, op.about ?? pivot(next, selected)))
        bump("scale", op.ids.length)
        break
      }
      case "restyle": {
        if (op.layer && !next.layers.some((layer) => layer.id === op.layer)) {
          throw new BlueprintError(`no such layer: ${op.layer}`)
        }
        const { op: _op, ids: _ids, ...changes } = op
        const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined))
        next.entities = mapSelected(next, new Set(op.ids), (entity) => ({ ...entity, ...defined }) as Entity)
        bump("restyle", op.ids.length)
        break
      }
      case "addLayer": {
        const id = op.layer.id ?? `l${next.layers.length}`
        if (next.layers.some((layer) => layer.id === id)) throw new BlueprintError(`layer already exists: ${id}`)
        next.layers = [...next.layers, { ...op.layer, id }]
        bump("add layer")
        break
      }
      case "setLayer": {
        if (!next.layers.some((layer) => layer.id === op.id)) throw new BlueprintError(`no such layer: ${op.id}`)
        next.layers = next.layers.map((layer) => (layer.id === op.id ? { ...layer, ...op.patch } : layer))
        bump("set layer")
        break
      }
      case "setView":
        next = { ...next, viewBox: op.viewBox }
        bump("set view")
        break
    }
  }

  return { doc: { ...next, seq: Math.max(seq, seqOf(next)) }, summary: describe(counts) }
}

/** `compose` re-exported so callers building their own matrices need one import. */
export { compose }
