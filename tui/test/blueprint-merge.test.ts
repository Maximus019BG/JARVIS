import { describe, expect, test } from "bun:test"
import { diffDocs, summarise } from "../src/blueprint/diff.ts"
import { merge3 } from "../src/blueprint/merge.ts"
import { applyOps, type Op } from "../src/blueprint/ops.ts"
import { emptyDoc, type BlueprintDoc } from "../src/blueprint/schema.ts"

const build = (...ops: Op[]) => applyOps(emptyDoc("plate"), ops).doc
const edit = (doc: BlueprintDoc, ...ops: Op[]) => applyOps(doc, ops).doc

const line = (a: [number, number], b: [number, number]): Op => ({ op: "add", entity: { type: "line", a, b } })

/** e1 and e2, the starting point for every merge scenario below. */
const base = () => build(line([0, 0], [10, 0]), line([0, 5], [10, 5]))

describe("diffDocs", () => {
  test("keys by id, so reordering is not a change", () => {
    const before = base()
    const after = { ...before, entities: [...before.entities].reverse() }
    expect(diffDocs(before, after).counts).toMatchObject({ added: 0, removed: 0, modified: 0, unchanged: 2 })
  })

  test("classifies add, remove and modify", () => {
    const before = base()
    const after = edit(before, { op: "move", ids: ["e1"], by: [1, 0] }, { op: "delete", ids: ["e2"] }, line([9, 9], [9, 8]))
    const diff = diffDocs(before, after)
    expect(diff.counts).toMatchObject({ added: 1, removed: 1, modified: 1, unchanged: 0 })
    expect(summarise(diff)).toBe("1 added, 1 removed, 1 modified")
  })

  test("a delete followed by an add reads as both, never as a modification", () => {
    // Only true because ids are never reused — otherwise the new circle would inherit
    // e2 and the whole history would claim a line turned into a circle.
    const before = base()
    const after = edit(before, { op: "delete", ids: ["e2"] }, { op: "add", entity: { type: "circle", c: [0, 0], r: 2 } })
    expect(diffDocs(before, after).counts).toMatchObject({ added: 1, removed: 1, modified: 0 })
    expect(after.entities.map((entity) => entity.id)).toEqual(["e1", "e3"])
  })

  test("a rewritten but identical document shows nothing", () => {
    const doc = base()
    const diff = diffDocs(doc, JSON.parse(JSON.stringify(doc)) as BlueprintDoc)
    expect(summarise(diff)).toBe("no geometry changes")
    expect(diff.viewBox).toBeUndefined()
  })

  test("reports layer and viewBox changes separately from entities", () => {
    const before = base()
    const after = edit(before, { op: "setView", viewBox: [0, 0, 100, 100] }, { op: "addLayer", layer: { name: "holes" } })
    const diff = diffDocs(before, after)
    expect(diff.viewBox).toEqual({ before: before.viewBox, after: [0, 0, 100, 100] })
    expect(diff.layers).toHaveLength(1)
    expect(diff.layers[0]).toMatchObject({ kind: "added", id: "l1" })
  })
})

describe("merge3", () => {
  test("takes a change made on only one side", () => {
    const start = base()
    const ours = edit(start, { op: "move", ids: ["e1"], by: [5, 0] })
    const { doc, conflicts } = merge3(start, ours, start)
    expect(conflicts).toEqual([])
    expect(doc.entities.find((entity) => entity.id === "e1")).toMatchObject({ a: [5, 0] })
  })

  test("takes a remote change to an entity we did not touch", () => {
    const start = base()
    const theirs = edit(start, { op: "move", ids: ["e2"], by: [0, 7] })
    const { doc, conflicts } = merge3(start, start, theirs)
    expect(conflicts).toEqual([])
    expect(doc.entities.find((entity) => entity.id === "e2")).toMatchObject({ a: [0, 12] })
  })

  test("combines independent additions from both sides without calling it a conflict", () => {
    const start = base()
    const ours = edit(start, line([1, 1], [2, 2]))
    const theirs = edit(start, line([3, 3], [4, 4]))
    const { doc, conflicts, renamed } = merge3(start, ours, theirs)
    // Both sides allocated e3 from the same counter. That needs a new id, not a decision.
    expect(conflicts).toEqual([])
    expect(renamed).toEqual([{ from: "e3", to: "e3-b" }])
    expect(doc.entities).toHaveLength(4)
    expect(doc.entities.map((entity) => entity.id)).toEqual(["e1", "e2", "e3", "e3-b"])
  })

  test("bumps seq past both sides, so the next add cannot reuse a merged id", () => {
    const start = base()
    const ours = edit(start, line([1, 1], [2, 2]))
    const theirs = edit(start, line([3, 3], [4, 4]))
    const { doc } = merge3(start, ours, theirs)
    const after = edit(doc, line([9, 9], [9, 8]))
    const ids = after.entities.map((entity) => entity.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("keeps both versions when the same entity was edited on both sides", () => {
    const start = base()
    const ours = edit(start, { op: "move", ids: ["e1"], by: [5, 0] })
    const theirs = edit(start, { op: "move", ids: ["e1"], by: [0, 9] })
    const { doc, conflicts } = merge3(start, ours, theirs)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ id: "e1", kind: "both-modified" })
    expect(doc.entities.find((entity) => entity.id === "e1")).toMatchObject({ a: [5, 0] })
    expect(doc.entities.find((entity) => entity.id === "e1-b")).toMatchObject({ a: [0, 9] })
  })

  test("identical edits on both sides are not a conflict", () => {
    const start = base()
    const both = edit(start, { op: "move", ids: ["e1"], by: [5, 0] })
    const { doc, conflicts } = merge3(start, both, both)
    expect(conflicts).toEqual([])
    expect(doc.entities).toHaveLength(2)
  })

  test("honours a remote delete of something we never touched", () => {
    const start = base()
    const theirs = edit(start, { op: "delete", ids: ["e2"] })
    const { doc, conflicts } = merge3(start, start, theirs)
    expect(conflicts).toEqual([])
    expect(doc.entities.map((entity) => entity.id)).toEqual(["e1"])
  })

  test("keeps our edit when they deleted what we changed, and says so", () => {
    const start = base()
    const ours = edit(start, { op: "move", ids: ["e2"], by: [1, 1] })
    const theirs = edit(start, { op: "delete", ids: ["e2"] })
    const { doc, conflicts } = merge3(start, ours, theirs)
    expect(conflicts[0]).toMatchObject({ kind: "deleted-remotely-modified-locally", id: "e2" })
    expect(doc.entities.find((entity) => entity.id === "e2")).toBeDefined()
  })

  test("keeps their edit when we deleted what they changed, and says so", () => {
    const start = base()
    const ours = edit(start, { op: "delete", ids: ["e2"] })
    const theirs = edit(start, { op: "move", ids: ["e2"], by: [1, 1] })
    const { doc, conflicts } = merge3(start, ours, theirs)
    expect(conflicts[0]).toMatchObject({ kind: "modified-remotely-deleted-locally", id: "e2" })
    expect(doc.entities.find((entity) => entity.id === "e2")).toMatchObject({ a: [1, 6] })
  })

  test("never loses geometry — every merge keeps at least what one side had", () => {
    const start = base()
    const ours = edit(start, { op: "move", ids: ["e1"], by: [5, 0] }, line([1, 1], [2, 2]))
    const theirs = edit(start, { op: "move", ids: ["e1"], by: [0, 9] }, line([7, 7], [8, 8]))
    const { doc } = merge3(start, ours, theirs)
    expect(doc.entities.length).toBeGreaterThanOrEqual(Math.max(ours.entities.length, theirs.entities.length))
  })

  test("unions the sheet so nothing lands off-page", () => {
    const start = base()
    const ours = edit(start, { op: "setView", viewBox: [0, 0, 100, 100] })
    const theirs = edit(start, { op: "setView", viewBox: [-50, 0, 100, 20] })
    expect(merge3(start, ours, theirs).doc.viewBox).toEqual([-50, 0, 150, 100])
  })

  test("brings in a layer only the other side has", () => {
    const start = base()
    const theirs = edit(start, { op: "addLayer", layer: { name: "holes" } })
    const { doc } = merge3(start, start, theirs)
    expect(doc.layers.map((layer) => layer.name)).toContain("holes")
  })

  test("an entity orphaned onto a deleted layer lands on the first one instead", () => {
    const start = edit(base(), { op: "addLayer", layer: { name: "holes" } })
    const theirs = edit(start, { op: "add", entity: { type: "circle", layer: "l1", c: [0, 0], r: 2 } })
    // We removed l1 entirely; their new circle still points at it.
    const ours: BlueprintDoc = { ...start, layers: start.layers.filter((layer) => layer.id !== "l1") }
    const { doc } = merge3(start, ours, theirs)
    const circle = doc.entities.find((entity) => entity.type === "circle")!
    expect(doc.layers.some((layer) => layer.id === circle.layer)).toBe(true)
  })

  test("the merged document is still a valid document", () => {
    const start = base()
    const ours = edit(start, { op: "move", ids: ["e1"], by: [5, 0] })
    const theirs = edit(start, { op: "move", ids: ["e1"], by: [0, 9] })
    const { doc } = merge3(start, ours, theirs)
    // applyOps revalidates every entity it touches, so a round trip proves the shape.
    expect(() => applyOps(doc, [{ op: "move", ids: ["e1-b"], by: [0, 0] }])).not.toThrow()
  })
})
