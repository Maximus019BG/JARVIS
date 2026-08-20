import { byId } from "./diff.ts"
import { canonicalEntity, seqOf, type BlueprintDoc, type Entity, type Layer, type Part } from "./schema.ts"

export type MergeConflict = {
  id: string
  kind: "both-modified" | "modified-remotely-deleted-locally" | "deleted-remotely-modified-locally"
  note: string
}

export type MergeResult = {
  doc: BlueprintDoc
  /** Genuine disagreements — a human should look at these. */
  conflicts: MergeConflict[]
  /**
   * Ids that had to move aside. Separate from `conflicts` because two people adding
   * unrelated lines both get `e7` from the same starting counter; that needs a new id,
   * not a decision. Crying conflict there would train people to ignore the real ones.
   */
  renamed: { from: string; to: string }[]
}

/**
 * The suffix a conflicting incoming entity gets. `nextId` already skips past suffixed ids,
 * so `e7` and `e7-b` can coexist forever without a later `add` colliding with either.
 */
const rename = (id: string) => `${id}-b`

const changed = (a: Entity | undefined, b: Entity | undefined) =>
  a === undefined || b === undefined ? a !== b : canonicalEntity(a) !== canonicalEntity(b)

/** Smallest rectangle containing both sheets, so nothing ends up off-page after a merge. */
function unionViewBox(a: BlueprintDoc["viewBox"], b: BlueprintDoc["viewBox"]): BlueprintDoc["viewBox"] {
  const minX = Math.min(a[0], b[0])
  const minY = Math.min(a[1], b[1])
  const maxX = Math.max(a[0] + a[2], b[0] + b[2])
  const maxY = Math.max(a[1] + a[3], b[1] + b[3])
  return [minX, minY, maxX - minX, maxY - minY]
}

/**
 * Parts, unioned by ref, ours winning a tie.
 *
 * A part is a record of geometry that lives in `entities`, so the entity merge above is
 * what actually decides whether a symbol survives — this only keeps the record in step
 * with it. Parts whose entities did not make it through are dropped, because a part
 * pointing at geometry nobody draws is exactly the stale port `connect` must never wire to.
 */
function mergeParts(ours: BlueprintDoc, theirs: BlueprintDoc, entities: readonly Entity[]): Part[] {
  const merged: Part[] = []
  const seen = new Set<string>()
  for (const part of [...(ours.parts ?? []), ...(theirs.parts ?? [])]) {
    const key = part.ref.toLowerCase()
    if (seen.has(key)) continue
    if (!entities.some((entity) => entity.id?.startsWith(`${part.prefix}-`))) continue
    seen.add(key)
    merged.push(part)
  }
  return merged
}

function mergeLayers(base: BlueprintDoc, ours: BlueprintDoc, theirs: BlueprintDoc): Layer[] {
  const baseLayers = new Map(base.layers.map((layer) => [layer.id, layer]))
  const ourLayers = new Map(ours.layers.map((layer) => [layer.id, layer]))
  const merged: Layer[] = []
  const seen = new Set<string>()

  for (const layer of ours.layers) {
    const from = baseLayers.get(layer.id)
    const theirVersion = theirs.layers.find((other) => other.id === layer.id)
    // Ours untouched but theirs edited -> take theirs. Otherwise ours wins; a layer is
    // presentation, and losing a colour is not worth a conflict entry.
    const weChanged = JSON.stringify(from) !== JSON.stringify(layer)
    merged.push(!weChanged && theirVersion ? theirVersion : layer)
    seen.add(layer.id)
  }
  for (const layer of theirs.layers) {
    if (!seen.has(layer.id) && !baseLayers.has(layer.id)) merged.push(layer)
  }
  // A layer deleted on both sides simply never gets re-added; one deleted only remotely
  // stays, because entities on our side may still reference it.
  return merged.filter((layer) => ourLayers.has(layer.id) || !baseLayers.has(layer.id))
}

/**
 * Three-way merge keyed by entity id. Never silently drops geometry: when both sides
 * edited the same entity, *both* versions survive — ours keeps its id, theirs is renamed —
 * and the caller is told. A drawing with one extra line in it is a five-second fix; a
 * drawing missing a line someone spent an hour on is not.
 *
 * `ours` is the local document, `theirs` the incoming one.
 */
export function merge3(base: BlueprintDoc, ours: BlueprintDoc, theirs: BlueprintDoc): MergeResult {
  const baseEntities = byId(base.entities)
  const ourEntities = byId(ours.entities)
  const theirEntities = byId(theirs.entities)
  const conflicts: MergeConflict[] = []
  const renamed: { from: string; to: string }[] = []
  const entities: Entity[] = []

  for (const entity of ours.entities) {
    const id = entity.id!
    const original = baseEntities.get(id)
    const remote = theirEntities.get(id)
    const weChanged = changed(original, entity)
    const theyChanged = changed(original, remote)

    if (!remote) {
      if (original && weChanged) {
        // They deleted it, we edited it. Keeping our edit is the conservative choice.
        conflicts.push({
          id,
          kind: "deleted-remotely-modified-locally",
          note: `${id} was deleted remotely but edited locally — kept the local version`,
        })
      }
      // `original && !weChanged` means they deleted an entity we never touched: honour it.
      if (original && !weChanged) continue
      entities.push(entity)
      continue
    }

    if (!weChanged) {
      entities.push(remote)
      continue
    }
    if (!theyChanged || !changed(entity, remote)) {
      entities.push(entity)
      continue
    }

    entities.push(entity)
    entities.push({ ...remote, id: rename(id) })
    renamed.push({ from: id, to: rename(id) })
    // No base version means both sides *added* something and the counter handed out the
    // same id twice. Both entities are wanted; only the name had to give.
    if (original) {
      conflicts.push({
        id,
        kind: "both-modified",
        note: `${id} was edited on both sides — the incoming version is kept as ${rename(id)}`,
      })
    }
  }

  // Entities only they have: new remote work, unless we deleted something they edited.
  for (const entity of theirs.entities) {
    const id = entity.id!
    if (ourEntities.has(id)) continue
    const original = baseEntities.get(id)
    if (!original) {
      entities.push(entity)
      continue
    }
    if (changed(original, entity)) {
      entities.push(entity)
      conflicts.push({
        id,
        kind: "modified-remotely-deleted-locally",
        note: `${id} was deleted locally but edited remotely — kept the incoming version`,
      })
    }
    // Deleted locally and untouched remotely: stays deleted.
  }

  const layers = mergeLayers(base, ours, theirs)
  const known = new Set(layers.map((layer) => layer.id))
  const fallback = layers[0]?.id ?? ours.layers[0]!.id
  const merged = entities.map((entity) => (known.has(entity.layer!) ? entity : { ...entity, layer: fallback }))

  return {
    doc: {
      ...ours,
      viewBox: unionViewBox(ours.viewBox, theirs.viewBox),
      layers: layers.length > 0 ? layers : ours.layers,
      // A merge can orphan an entity onto a layer the other side deleted; parking it on
      // the first layer keeps the document valid rather than unparseable.
      entities: merged,
      parts: mergeParts(ours, theirs, merged),
      // Past both sides' counters, so the next `add` on either cannot reuse an id that
      // now exists here.
      seq: Math.max(seqOf(ours), seqOf(theirs), seqOf({ entities: merged })),
    },
    conflicts,
    renamed,
  }
}
