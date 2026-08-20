import { z } from "zod"
import { apply, bbox, compose, rotate, scale, transform, translate, type Mat } from "./geom.ts"
import { arrangeParts } from "./arrange.ts"
import { placeSymbol, prefixFor, refIn } from "./place.ts"
import { junctionsAt, obstaclesFor, portAt, refOf, routeWire } from "./route.ts"
import { findSymbol } from "./symbols/index.ts"
import {
  BlueprintError,
  EntitySchema,
  LayerSchema,
  seqOf,
  type BlueprintDoc,
  type Entity,
  type Part,
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
  /**
   * Place a library symbol. One op rather than the handful of `add`s it expands to, so the
   * placement is one undo step, the `parts` record is written by the engine rather than by
   * each caller, and a symbol dropped in the web editor is identical to one the agent placed.
   */
  z.object({
    op: z.literal("place"),
    symbol: z.string().describe('Symbol name, e.g. "resistor" or "electrical/resistor" when the bare name is ambiguous'),
    at: point.describe("Roughly where to put it; schematic symbols are snapped to the 2.54 mm grid"),
    rotate: z.number().optional().describe("Degrees clockwise about `at`, because Y points down"),
    scale: z.number().positive().optional(),
    layer: z.string().optional(),
    label: z
      .string()
      .optional()
      .describe(
        'Reference designator, e.g. "R1" — this is what `connect` addresses. May carry an annotation after a bar, ' +
          '"U1 | mA=240, V=3.3", which blueprint_check reads; the reference is the part before the bar.',
      ),
    labelOffset: point.optional(),
  }),
  /**
   * Wire two ports together. The caller names the ports; the engine works out the route,
   * so nobody has to do the trigonometry or guess a path around the other parts.
   */
  z.object({
    op: z.literal("connect"),
    from: z.string().describe('Start port as "REF.PORT", 1-based — e.g. "R1.2"'),
    to: z.string().describe('End port as "REF.PORT" — e.g. "U1.5"'),
    layer: z.string().optional(),
    label: z.string().optional().describe('Net annotation, e.g. "W1 | mm2=2.5, A=16" — read by blueprint_check'),
  }),
  /** Snap parts to the schematic grid and push apart any that overlap. */
  z.object({ op: z.literal("arrange"), refs: z.array(z.string()).optional().describe("Omitted means every part") }),
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

/** Whether a part's own entities are among the ids being transformed. */
const owns = (part: Part, selected: Set<string>) =>
  [...selected].some((id) => id.startsWith(`${part.prefix}-`))

/**
 * Moves a part's anchor and ports through the same matrix as its entities.
 *
 * Without this a `move` slides the drawn resistor across the sheet while its stored ports
 * stay behind, and the next `connect` wires to where the part used to be — silently, and
 * only visible once somebody looks at the picture. A part whose entities are only
 * partially selected is left alone: half a symbol moving is already a mistake, and
 * guessing which half the ports follow would compound it.
 */
function movePartsWith(parts: readonly Part[], selected: Set<string>, m: Mat, entities: readonly Entity[]): Part[] {
  return parts.map((part) => {
    if (!owns(part, selected)) return part
    const mine = entities.filter((entity) => entity.id?.startsWith(`${part.prefix}-`)).map((entity) => entity.id!)
    if (!mine.every((id) => selected.has(id))) return part
    return { ...part, at: apply(m, part.at), ports: part.ports.map((port) => apply(m, port)) }
  })
}

/** Human-readable tally, used as the commit message when the caller supplies none. */
function describe(counts: Map<string, number>): string {
  if (counts.size === 0) return "no changes"
  return [...counts.entries()].map(([what, n]) => (n > 1 ? `${what} ×${n}` : what)).join(", ")
}

export type OpResult = {
  doc: BlueprintDoc
  summary: string
  /**
   * Things that were done but not done well — a wire that had to cross a part because no
   * clean route existed. Not errors: the drawing is still valid, but silently shipping a
   * route that runs through a chip would be the checker's sin of passing what it could not
   * read, one layer down.
   */
  warnings: string[]
}

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
  /** Wire ids are their own series so a route never collides with a hand-drawn entity. */
  let wires = next.entities.reduce((highest, entity) => {
    const match = /^w(\d+)$/.exec(entity.id ?? "")
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  const blocked: string[] = []

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
        // A part whose geometry has all been deleted is not a part any more. Leaving the
        // record behind would let `connect` wire to ports nothing draws.
        next.parts = next.parts.filter((part) => kept.some((entity) => entity.id?.startsWith(`${part.prefix}-`)))
        bump("delete", removed)
        break
      }
      case "move": {
        const selected = new Set(op.ids)
        const m = translate(op.by[0], op.by[1])
        // Parts first: it reads the entity list as it was, to decide whether a whole
        // symbol is selected rather than a piece of one.
        next.parts = movePartsWith(next.parts, selected, m, next.entities)
        next.entities = applyMat(next, selected, m)
        bump("move", op.ids.length)
        break
      }
      case "rotate": {
        const selected = new Set(op.ids)
        const m = rotate(op.deg, op.about ?? pivot(next, selected))
        next.parts = movePartsWith(next.parts, selected, m, next.entities)
        next.entities = applyMat(next, selected, m)
        bump("rotate", op.ids.length)
        break
      }
      case "scale": {
        const selected = new Set(op.ids)
        const m = scale(op.by, op.by, op.about ?? pivot(next, selected))
        next.parts = movePartsWith(next.parts, selected, m, next.entities)
        next.entities = applyMat(next, selected, m)
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
      case "place": {
        const { op: _op, ...placement } = op
        // The index only has to make the id prefix unique. Counting placements ever made
        // rather than parts currently present means deleting one never frees its prefix
        // for the next placement — same reasoning as `seq` for entity ids.
        let index = next.parts.length
        const ref = op.label ? refIn(op.label) : undefined
        while (next.parts.some((part) => part.prefix === prefixFor(ref, op.symbol, index + 1))) index += 1
        const placed = placeSymbol(placement, index)
        if (!placed) {
          throw new BlueprintError(`no such symbol: ${op.symbol} — use blueprint_symbol action:"list" to find one`)
        }
        if (next.parts.some((part) => part.ref.toLowerCase() === placed.part.ref.toLowerCase())) {
          throw new BlueprintError(`reference ${placed.part.ref} is already used — give this one a different label`)
        }
        // Recurse through applyOps so the symbol's entities go through exactly the same
        // validation, id allocation and layer checks as anything else added by hand.
        const inner = applyOps({ ...next, parts: [] }, placed.ops)
        next = { ...inner.doc, parts: [...next.parts, placed.part] }
        seq = Math.max(seq, seqOf(next))
        bump(`place ${op.symbol}`)
        break
      }
      case "connect": {
        const from = portAt(next, op.from)
        const to = portAt(next, op.to)
        const route = routeWire(from, to, obstaclesFor(next, [refOf(op.from), refOf(op.to)]))
        const layer = op.layer ?? next.layers[0]!.id
        if (!next.layers.some((existing) => existing.id === layer)) {
          throw new BlueprintError(`no such layer: ${layer}`)
        }
        const wire: Op[] = [
          { op: "add", entity: { type: "polyline", pts: route.path, layer, id: `w${++wires}` } },
        ]
        if (op.label) {
          // Written as a text entity in the `REF | key=value` grammar so `checkDoc` can
          // read the wire — that is what makes ampacity, voltage drop and pin clashes
          // apply to a routed net rather than only to a hand-annotated one.
          const mid = route.path[Math.floor(route.path.length / 2)] ?? from
          wire.push({
            op: "add",
            entity: { type: "text", at: [mid[0], mid[1] - 1.5], text: op.label, size: 2, layer, id: `w${wires}-label` },
          })
        }
        // Junctions are read against the drawing as it stands: once the new wire is in,
        // both its own endpoints lie on it and everything looks like a T.
        const junctions = junctionsAt(next, [from, to]).filter(
          (at) => !next.parts.some((part) => part.symbol.endsWith("junction-dot") && part.at[0] === at[0] && part.at[1] === at[1]),
        )
        const inner = applyOps({ ...next, parts: [] }, wire)
        next = { ...inner.doc, parts: next.parts }
        if (junctions.length > 0) {
          // Qualified by the domain of what is being wired: both the electrical and the iot
          // library have a `junction-dot`, so a bare name would take whichever comes first.
          const domain = findSymbol(next.parts.find((part) => part.ref.toLowerCase() === refOf(op.from).toLowerCase())?.symbol ?? "")?.domain
          next = applyOps(
            next,
            junctions.map((at) => ({ op: "place" as const, symbol: `${domain ?? "electrical"}/junction-dot`, at, layer })),
          ).doc
        }
        seq = Math.max(seq, seqOf(next))
        if (route.blocked) blocked.push(`${op.from}→${op.to}`)
        bump("connect")
        break
      }
      case "arrange": {
        const moves = arrangeParts(next, op.refs)
        if (moves.size === 0) break
        const inner = applyOps(
          next,
          [...moves].map(([ref, by]) => {
            const part = next.parts.find((candidate) => candidate.ref === ref)!
            return {
              op: "move" as const,
              ids: next.entities.filter((entity) => entity.id?.startsWith(`${part.prefix}-`)).map((entity) => entity.id!),
              by,
            }
          }),
        )
        next = inner.doc
        bump("arrange", moves.size)
        break
      }
    }
  }

  const warnings = blocked.length > 0
    ? [`no clear route for ${blocked.join(", ")} — the wire crosses a part; move it or route it by hand`]
    : []
  return { doc: { ...next, seq: Math.max(seq, seqOf(next)) }, summary: describe(counts), warnings }
}

/** `compose` re-exported so callers building their own matrices need one import. */
export { compose }
