import { canonicalEntity, type BlueprintDoc, type Entity, type Layer } from "./schema.ts"

export type ChangeKind = "added" | "removed" | "modified" | "unchanged"

export type EntityChange =
  | { kind: "added"; id: string; after: Entity }
  | { kind: "removed"; id: string; before: Entity }
  | { kind: "modified"; id: string; before: Entity; after: Entity }
  | { kind: "unchanged"; id: string; after: Entity }

export type LayerChange =
  | { kind: "added"; id: string; after: Layer }
  | { kind: "removed"; id: string; before: Layer }
  | { kind: "modified"; id: string; before: Layer; after: Layer }

export type DocDiff = {
  entities: EntityChange[]
  layers: LayerChange[]
  viewBox?: { before: BlueprintDoc["viewBox"]; after: BlueprintDoc["viewBox"] }
  name?: { before: string; after: string }
  counts: Record<ChangeKind, number>
}

export const byId = (entities: readonly Entity[]): Map<string, Entity> =>
  new Map(entities.map((entity) => [entity.id!, entity]))

/**
 * Entity-id keyed, so moving an entity in the list is not a change and editing one is not
 * a delete plus an add. This is the shared primitive under both the web's visual diff and
 * `merge3` — they must agree on what "changed" means or a merge will drop work the diff
 * said was untouched.
 *
 * Output order is `before`'s order, with anything only in `after` appended, so a rendered
 * diff reads top-to-bottom like the file does.
 */
export function diffDocs(before: BlueprintDoc, after: BlueprintDoc): DocDiff {
  const oldEntities = byId(before.entities)
  const newEntities = byId(after.entities)
  const entities: EntityChange[] = []

  for (const [id, from] of oldEntities) {
    const to = newEntities.get(id)
    if (!to) entities.push({ kind: "removed", id, before: from })
    else if (canonicalEntity(from) !== canonicalEntity(to)) entities.push({ kind: "modified", id, before: from, after: to })
    else entities.push({ kind: "unchanged", id, after: to })
  }
  for (const [id, to] of newEntities) {
    if (!oldEntities.has(id)) entities.push({ kind: "added", id, after: to })
  }

  const oldLayers = new Map(before.layers.map((layer) => [layer.id, layer]))
  const newLayers = new Map(after.layers.map((layer) => [layer.id, layer]))
  const layers: LayerChange[] = []
  for (const [id, from] of oldLayers) {
    const to = newLayers.get(id)
    if (!to) layers.push({ kind: "removed", id, before: from })
    else if (JSON.stringify(from) !== JSON.stringify(to)) layers.push({ kind: "modified", id, before: from, after: to })
  }
  for (const [id, to] of newLayers) {
    if (!oldLayers.has(id)) layers.push({ kind: "added", id, after: to })
  }

  const counts: Record<ChangeKind, number> = { added: 0, removed: 0, modified: 0, unchanged: 0 }
  for (const change of entities) counts[change.kind]++

  return {
    entities,
    layers,
    viewBox:
      JSON.stringify(before.viewBox) === JSON.stringify(after.viewBox)
        ? undefined
        : { before: before.viewBox, after: after.viewBox },
    name: before.name === after.name ? undefined : { before: before.name, after: after.name },
    counts,
  }
}

/** `3 added, 1 modified` — the one-line form for a timeline row. */
export function summarise(diff: DocDiff): string {
  const parts = (["added", "removed", "modified"] as const)
    .filter((kind) => diff.counts[kind] > 0)
    .map((kind) => `${diff.counts[kind]} ${kind}`)
  return parts.length > 0 ? parts.join(", ") : "no geometry changes"
}
