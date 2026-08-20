import { describe, expect, test } from "bun:test"
import { bbox, flatten, rotate, transform, translate } from "../src/blueprint/geom.ts"
import { applyOps } from "../src/blueprint/ops.ts"
import { autoView, renderBraille, renderCells } from "../src/blueprint/render-braille.ts"
import { toSvg } from "../src/blueprint/render-svg.ts"
import {
  BlueprintDocSchema,
  BlueprintError,
  emptyDoc,
  parseDoc,
  seqOf,
  serialize,
  type BlueprintDoc,
} from "../src/blueprint/schema.ts"

const doc = (): BlueprintDoc => emptyDoc("plate")

const withEntities = (...ops: Parameters<typeof applyOps>[1]) => applyOps(doc(), ops).doc

describe("add validates the flat entity payload", () => {
  // `blueprint_edit` takes `entity` as one flat object with every field optional so a model
  // does not have to pick a variant inside a variant. applyOps is the only thing that narrows
  // it back, so these are the tests that the loosened schema did not loosen validation.
  test("a field the type requires cannot be missing", () => {
    expect(() => withEntities({ op: "add", entity: { type: "circle", c: [0, 0] } })).toThrow(BlueprintError)
    expect(() => withEntities({ op: "add", entity: { type: "line", a: [0, 0] } })).toThrow(BlueprintError)
    expect(() => withEntities({ op: "add", entity: { type: "text", at: [0, 0] } })).toThrow(BlueprintError)
  })

  test("a field the type requires cannot be out of range", () => {
    expect(() => withEntities({ op: "add", entity: { type: "circle", c: [0, 0], r: -1 } })).toThrow(BlueprintError)
  })

  test("the error names the type, so the model knows which shape it got wrong", () => {
    expect(() => withEntities({ op: "add", entity: { type: "circle", c: [0, 0] } })).toThrow(/circle/)
  })

  test("fields belonging to another type are dropped, not stored", () => {
    // A model that sends a circle with a stray `a` from the line shape gets a clean circle.
    const [entity] = withEntities({ op: "add", entity: { type: "circle", c: [1, 2], r: 3, a: [9, 9] } }).entities
    expect(entity).toMatchObject({ type: "circle", c: [1, 2], r: 3 })
    expect(entity).not.toHaveProperty("a")
  })

  test("a path still round-trips through the loose `d` field", () => {
    const [entity] = withEntities({
      op: "add",
      entity: { type: "path", d: [["M", 0, 0], ["L", 10, 0], ["Q", 10, 5, 5, 5], ["Z"]] },
    }).entities
    expect(entity).toMatchObject({ type: "path" })
    expect((entity as { d: unknown[] }).d).toHaveLength(4)
  })

  test("a path command with the wrong arity is refused", () => {
    expect(() => withEntities({ op: "add", entity: { type: "path", d: [["M", 0]] } })).toThrow(BlueprintError)
  })
})

describe("serialize", () => {
  test("round-trips through parseDoc", () => {
    const built = withEntities(
      { op: "add", entity: { type: "line", a: [0, 0], b: [100, 0] } },
      { op: "add", entity: { type: "circle", c: [50, 30], r: 12 } },
      { op: "add", entity: { type: "path", d: [["M", 0, 0], ["C", 10, 20, 30, 20, 40, 0]] } },
      { op: "add", entity: { type: "text", at: [5, 5], text: "M6" } },
      { op: "add", entity: { type: "dimension", a: [0, 0], b: [100, 0], offset: 8 } },
    )
    expect(parseDoc(serialize(built))).toEqual(built)
  })

  test("is byte-stable across calls and after a reparse", () => {
    const built = withEntities({ op: "add", entity: { type: "rect", at: [10, 10], w: 80, h: 40, rx: 4 } })
    const once = serialize(built)
    expect(serialize(built)).toBe(once)
    expect(serialize(parseDoc(once))).toBe(once)
  })

  test("puts one entity per line so diffs stay readable", () => {
    const built = withEntities(
      { op: "add", entity: { type: "line", a: [0, 0], b: [1, 0] } },
      { op: "add", entity: { type: "line", a: [1, 0], b: [1, 1] } },
    )
    const entityLines = serialize(built)
      .split("\n")
      .filter((line) => line.includes('"type"'))
    expect(entityLines).toHaveLength(2)
  })

  test("rounds float noise away rather than letting it produce a diff", () => {
    const built = withEntities({ op: "add", entity: { type: "line", a: [0.1 + 0.2, 0], b: [1, 0] } })
    expect(serialize(built)).toContain("[0.3,0]")
  })

  test("writes an empty entity list without a blank line", () => {
    expect(serialize(doc())).toContain('"entities": []')
  })

  test("rejects a document that is not a blueprint", () => {
    expect(() => parseDoc('{"schema":1}')).toThrow(BlueprintError)
    expect(() => parseDoc("not json")).toThrow(BlueprintError)
  })

  test("backfills ids and layers on a hand-written file", () => {
    const raw = JSON.stringify({
      schema: 1,
      id: "bp_x",
      name: "hand",
      units: "mm",
      viewBox: [0, 0, 10, 10],
      layers: [{ id: "l0", name: "outline" }],
      entities: [{ type: "line", a: [0, 0], b: [1, 1] }],
    })
    const parsed = parseDoc(raw)
    expect(parsed.entities[0]!.id).toBe("e1")
    expect(parsed.entities[0]!.layer).toBe("l0")
  })

  test("seqOf counts past merge-suffixed ids and a stale stored counter", () => {
    expect(seqOf({ entities: [{ type: "line", id: "e7-b", a: [0, 0], b: [1, 1] }] })).toBe(7)
    // A hand-edited file that added a high id without touching `seq` must not collide.
    expect(seqOf({ seq: 2, entities: [{ type: "line", id: "e40", a: [0, 0], b: [1, 1] }] })).toBe(40)
    expect(seqOf({ seq: 9, entities: [] })).toBe(9)
  })

  test("ids are never reused after a delete", () => {
    const built = withEntities(
      { op: "add", entity: { type: "line", a: [0, 0], b: [1, 0] } },
      { op: "add", entity: { type: "line", a: [0, 5], b: [1, 5] } },
      { op: "delete", ids: ["e2"] },
      { op: "add", entity: { type: "circle", c: [0, 0], r: 1 } },
    )
    expect(built.entities.map((entity) => entity.id)).toEqual(["e1", "e3"])
    expect(built.seq).toBe(3)
  })
})

describe("geom", () => {
  test("flattens a circle into a closed ring", () => {
    const [ring] = flatten({ type: "circle", id: "e1", c: [0, 0], r: 10 })
    expect(ring!.length).toBeGreaterThan(8)
    expect(ring![0]![0]).toBeCloseTo(ring!.at(-1)![0]!, 6)
    expect(ring![0]![1]).toBeCloseTo(ring!.at(-1)![1]!, 6)
    for (const [x, y] of ring!) expect(Math.hypot(x, y)).toBeCloseTo(10, 1)
  })

  test("bbox of a rect rotated 45 degrees grows by root two", () => {
    const spun = transform({ type: "rect", id: "e1", at: [-5, -5], w: 10, h: 10 }, rotate(45))
    const [minX, minY, maxX, maxY] = bbox([spun])!
    expect(maxX - minX).toBeCloseTo(Math.SQRT2 * 10, 1)
    expect(maxY - minY).toBeCloseTo(Math.SQRT2 * 10, 1)
  })

  test("translate moves every point and leaves size alone", () => {
    const moved = transform({ type: "circle", id: "e1", c: [0, 0], r: 5 }, translate(10, -3))
    expect(moved).toMatchObject({ c: [10, -3], r: 5 })
  })

  test("a rounded rect stays inside its unrounded bounds", () => {
    const box = bbox([{ type: "rect", id: "e1", at: [0, 0], w: 20, h: 10, rx: 3 }])!
    expect(box[0]).toBeCloseTo(0, 3)
    expect(box[1]).toBeCloseTo(0, 3)
    expect(box[2]).toBeCloseTo(20, 3)
    expect(box[3]).toBeCloseTo(10, 3)
  })

  test("text contributes its anchor to the bounds but no geometry", () => {
    expect(flatten({ type: "text", id: "e1", at: [4, 4], text: "hi" })).toEqual([])
    expect(bbox([{ type: "text", id: "e1", at: [4, 4], text: "hi" }])).toEqual([4, 4, 4, 4])
  })
})

describe("applyOps", () => {
  test("assigns ids and the first layer on add", () => {
    const built = withEntities({ op: "add", entity: { type: "line", a: [0, 0], b: [1, 1] } })
    expect(built.entities[0]).toMatchObject({ id: "e1", layer: "l0" })
  })

  test("honours an explicit id, and moves what it just added", () => {
    // The whole of symbol stamping rests on this: add the parts under known ids, then
    // place them with one transform, in a single batch.
    const built = withEntities(
      { op: "add", entity: { id: "r1-a", type: "line", a: [0, 0], b: [10, 0] } },
      { op: "add", entity: { id: "r1-b", type: "rect", at: [3, -2], w: 4, h: 4 } },
      { op: "move", ids: ["r1-a", "r1-b"], by: [40, 60] },
      { op: "rotate", ids: ["r1-a", "r1-b"], deg: 90, about: [40, 60] },
    )
    expect(built.entities.map((entity) => entity.id)).toEqual(["r1-a", "r1-b"])
    // (0,0) pinned at the pivot; (10,0) swings 90° clockwise to (0,10) relative to it.
    expect(built.entities[0]).toMatchObject({ a: [40, 60], b: [40, 70] })
  })

  test("refuses an id that is already taken", () => {
    expect(() =>
      withEntities(
        { op: "add", entity: { id: "r1-a", type: "line", a: [0, 0], b: [1, 1] } },
        { op: "add", entity: { id: "r1-a", type: "circle", c: [0, 0], r: 1 } },
      ),
    ).toThrow(BlueprintError)
  })

  test("never mutates the input document", () => {
    const original = doc()
    applyOps(original, [{ op: "add", entity: { type: "line", a: [0, 0], b: [1, 1] } }])
    expect(original.entities).toHaveLength(0)
  })

  test("summarises what happened, for the commit message", () => {
    const { summary } = applyOps(doc(), [
      { op: "add", entity: { type: "line", a: [0, 0], b: [1, 1] } },
      { op: "add", entity: { type: "line", a: [1, 1], b: [2, 2] } },
      { op: "add", entity: { type: "circle", c: [0, 0], r: 1 } },
    ])
    expect(summary).toBe("add line ×2, add circle")
  })

  test("moves only the selected entities", () => {
    const start = withEntities(
      { op: "add", entity: { type: "line", a: [0, 0], b: [1, 0] } },
      { op: "add", entity: { type: "line", a: [0, 5], b: [1, 5] } },
    )
    const moved = applyOps(start, [{ op: "move", ids: ["e1"], by: [10, 0] }]).doc
    expect(moved.entities[0]).toMatchObject({ a: [10, 0], b: [11, 0] })
    expect(moved.entities[1]).toMatchObject({ a: [0, 5], b: [1, 5] })
  })

  test("scales about the selection centre when no pivot is given", () => {
    const start = withEntities({ op: "add", entity: { type: "circle", c: [10, 10], r: 5 } })
    const scaled = applyOps(start, [{ op: "scale", ids: ["e1"], by: 2 }]).doc
    expect(scaled.entities[0]).toMatchObject({ c: [10, 10], r: 10 })
  })

  test("update revalidates, so a patch cannot produce an impossible entity", () => {
    const start = withEntities({ op: "add", entity: { type: "circle", c: [0, 0], r: 5 } })
    expect(() => applyOps(start, [{ op: "update", id: "e1", patch: { r: -1 } }])).toThrow(BlueprintError)
    expect(applyOps(start, [{ op: "update", id: "e1", patch: { r: 9 } }]).doc.entities[0]).toMatchObject({ r: 9 })
  })

  test("refuses unknown ids instead of silently skipping them", () => {
    const start = withEntities({ op: "add", entity: { type: "line", a: [0, 0], b: [1, 1] } })
    expect(() => applyOps(start, [{ op: "move", ids: ["e9"], by: [1, 1] }])).toThrow(/no such entity/)
    expect(() => applyOps(start, [{ op: "delete", ids: ["e9"] }])).toThrow(/no such entity/)
  })

  test("refuses an unknown layer", () => {
    expect(() => applyOps(doc(), [{ op: "add", entity: { type: "line", layer: "nope", a: [0, 0], b: [1, 1] } }])).toThrow(
      /no such layer/,
    )
  })

  test("a failed op leaves nothing partially applied", () => {
    const start = doc()
    expect(() =>
      applyOps(start, [
        { op: "add", entity: { type: "line", a: [0, 0], b: [1, 1] } },
        { op: "move", ids: ["missing"], by: [1, 1] },
      ]),
    ).toThrow()
    expect(start.entities).toHaveLength(0)
  })

  test("addLayer then draw onto it", () => {
    const built = applyOps(doc(), [
      { op: "addLayer", layer: { name: "holes", color: "#b91c1c" } },
      { op: "add", entity: { type: "circle", layer: "l1", c: [0, 0], r: 3 } },
    ]).doc
    expect(built.layers).toHaveLength(2)
    expect(built.entities[0]!.layer).toBe("l1")
  })
})

describe("renderers", () => {
  test("braille draws dots for a line and leaves blank rows empty", () => {
    const built = withEntities({ op: "add", entity: { type: "line", a: [0, 0], b: [100, 0] } })
    const lines = renderBraille(built, { cols: 20, rows: 4 })
    expect(lines.join("")).toMatch(/[⠁-⣿]/)
    expect(lines).toHaveLength(4)
  })

  test("braille writes a label into the picture, where the thing it names is", () => {
    const built = withEntities({ op: "add", entity: { type: "text", at: [5, 5], text: "M6" } })
    const lines = renderBraille(built, { cols: 20, rows: 4 })
    expect(lines.some((line) => line.includes("M6"))).toBe(true)
  })

  test("a label that will not fit is still listed underneath, never dropped in silence", () => {
    // Two labels on the same spot: one wins the cells, the other has to be reported.
    const built = withEntities(
      { op: "add", entity: { type: "text", at: [5, 5], text: "M6" } },
      { op: "add", entity: { type: "text", at: [5, 5], text: "M8" } },
    )
    const out = renderBraille(built, { cols: 20, rows: 4 }).join("\n")
    expect(out).toContain("M6")
    expect(out).toContain('"M8" at 5, 5')
  })

  test("cells carry the layer that drew them, so a pane can colour by layer", () => {
    const built = applyOps(doc(), [
      { op: "addLayer", layer: { name: "power", color: "#ff0000" } },
      { op: "add", entity: { type: "line", a: [0, 0], b: [50, 0], layer: "l1" } },
    ]).doc
    const { cells } = renderCells(built, { cols: 20, rows: 4 })
    const lit = cells.flat().filter((cell) => cell.ch !== "\u2800")
    expect(lit.length).toBeGreaterThan(0)
    expect(lit.every((cell) => cell.layer === "l1")).toBe(true)
  })

  test("a cell and a document point convert back and forth", () => {
    const built = withEntities({ op: "add", entity: { type: "rect", at: [0, 0], w: 100, h: 100 } })
    const rendered = renderCells(built, { cols: 40, rows: 20 })
    const [col, row] = rendered.toCell([50, 50])
    const [x, y] = rendered.toDoc(col, row)
    // Round-trip lands within one cell, which is all a cursor needs.
    expect(Math.abs(x - 50)).toBeLessThan(rendered.view[2] / 40 + 1)
    expect(Math.abs(y - 50)).toBeLessThan(rendered.view[3] / 20 + 1)
  })

  test("the scale bar says how big the picture is", () => {
    const built = withEntities({ op: "add", entity: { type: "rect", at: [0, 0], w: 100, h: 60 } })
    const { cells } = renderCells(built, { cols: 40, rows: 10, scaleBar: true })
    expect(cells.at(-1)!.map((cell) => cell.ch).join("")).toMatch(/^\u251c\u2500+ \d+(\.\d+)? mm \u2500+\u2524$/)
  })

  test("grid dots do not claim a cell the drawing wants", () => {
    const built = withEntities({ op: "add", entity: { type: "line", a: [0, 0], b: [100, 0] } })
    const { cells } = renderCells(built, { cols: 40, rows: 10, grid: 10 })
    const drawn = cells.flat().filter((cell) => cell.layer === "l0")
    expect(drawn.length).toBeGreaterThan(0)
  })

  test("autoView fits the drawing, not the empty sheet", () => {
    const built = withEntities({ op: "add", entity: { type: "circle", c: [10, 10], r: 5 } })
    const [x, y, w, h] = autoView(built)
    expect(w).toBeLessThan(20)
    expect(h).toBeLessThan(20)
    expect(x).toBeLessThan(5)
    expect(y).toBeLessThan(5)
  })

  test("autoView falls back to the sheet when nothing is drawn", () => {
    expect(autoView(doc())).toEqual(doc().viewBox)
  })

  test("hidden layers are not drawn", () => {
    const built = applyOps(doc(), [
      { op: "add", entity: { type: "circle", c: [10, 10], r: 5 } },
      { op: "setLayer", id: "l0", patch: { visible: false } },
    ]).doc
    expect(renderBraille(built, { cols: 20, rows: 4 }).join("")).not.toMatch(/[⠁-⣿]/)
  })

  test("svg keeps curves as curves and escapes text", () => {
    const built = withEntities(
      { op: "add", entity: { type: "circle", c: [50, 30], r: 12 } },
      { op: "add", entity: { type: "arc", c: [0, 0], r: 20, a0: 0, a1: 90 } },
      { op: "add", entity: { type: "text", at: [5, 5], text: "a<b>&c" } },
    )
    const svg = toSvg(built)
    expect(svg).toContain('<circle id="e1" cx="50" cy="30" r="12"')
    expect(svg).toContain(" A 20 20 0 0 1 ")
    expect(svg).toContain("a&lt;b&gt;&amp;c")
    expect(svg).toContain('viewBox="0 0 297 210"')
  })

  test("svg draws a full-turn arc as a circle, which has no arc form", () => {
    const built = withEntities({ op: "add", entity: { type: "arc", c: [0, 0], r: 5, a0: 0, a1: 360 } })
    expect(toSvg(built)).toContain("<circle")
  })

  test("svg normalises a negative-size rect", () => {
    const built = withEntities({ op: "add", entity: { type: "rect", at: [10, 10], w: -10, h: -4 } })
    expect(toSvg(built)).toContain('x="0" y="6" width="10" height="4"')
  })
})

describe("parts", () => {
  // A part is the record that makes `connect` possible: the entities a symbol produces are
  // ordinary geometry, and without the record nothing knows which arc is a resistor or
  // where its ports went. These are the tests that the record cannot drift from the
  // geometry — every one of them is a way the drawing silently wires the wrong point.
  const placed = () =>
    applyOps(doc(), [
      { op: "place", symbol: "electrical/resistor", at: [20, 20], label: "R1" },
      { op: "place", symbol: "electrical/resistor", at: [60, 20], label: "R2" },
    ]).doc

  test("a placement is remembered, with its ports in document space", () => {
    const built = placed()
    expect(built.parts.map((part) => part.ref)).toEqual(["R1", "R2"])
    const r1 = built.parts[0]!
    expect(r1.at).toEqual([20.32, 20.32]) // snapped to the 2.54 grid
    expect(r1.ports.length).toBeGreaterThan(0)
    for (const port of r1.ports) expect(Math.hypot(port[0] - r1.at[0], port[1] - r1.at[1])).toBeLessThan(20)
  })

  test("parts survive serialize and parse", () => {
    const back = parseDoc(serialize(placed()))
    expect(back.parts).toEqual(placed().parts)
  })

  test("a document written before parts existed still parses", () => {
    const legacy = serialize(doc()).replace(/,\n  "parts": \[\]/, "")
    expect(parseDoc(legacy).parts).toEqual([])
  })

  test("a duplicate reference is refused, because connect addresses by it", () => {
    expect(() =>
      applyOps(placed(), [{ op: "place", symbol: "electrical/resistor", at: [0, 0], label: "r1" }]),
    ).toThrow(/already used/)
  })

  test("moving a symbol's entities moves its anchor and its ports with them", () => {
    const built = placed()
    const r1 = built.parts[0]!
    const ids = built.entities.filter((entity) => entity.id!.startsWith(`${r1.prefix}-`)).map((entity) => entity.id!)
    const after = applyOps(built, [{ op: "move", ids, by: [10, 5] }]).doc
    const moved = after.parts[0]!
    expect(moved.at).toEqual([r1.at[0] + 10, r1.at[1] + 5])
    expect(moved.ports).toEqual(r1.ports.map((port) => [port[0] + 10, port[1] + 5]))
    // The part left alone must not have drifted.
    expect(after.parts[1]).toEqual(built.parts[1])
  })

  test("rotating a symbol rotates its ports, so a turned part still connects", () => {
    const built = placed()
    const r1 = built.parts[0]!
    const ids = built.entities.filter((entity) => entity.id!.startsWith(`${r1.prefix}-`)).map((entity) => entity.id!)
    const after = applyOps(built, [{ op: "rotate", ids, deg: 90, about: r1.at }]).doc
    const spun = after.parts[0]!
    expect(spun.ports).not.toEqual(r1.ports)
    // A rotation about the anchor keeps every port the same distance from it.
    for (let i = 0; i < r1.ports.length; i += 1) {
      const was = Math.hypot(r1.ports[i]![0] - r1.at[0], r1.ports[i]![1] - r1.at[1])
      const is = Math.hypot(spun.ports[i]![0] - spun.at[0], spun.ports[i]![1] - spun.at[1])
      expect(is).toBeCloseTo(was, 6)
    }
  })

  test("moving half a symbol leaves the record alone rather than guessing", () => {
    const built = placed()
    const first = built.entities.find((entity) => entity.id!.startsWith(`${built.parts[0]!.prefix}-`))!
    const after = applyOps(built, [{ op: "move", ids: [first.id!], by: [10, 0] }]).doc
    expect(after.parts[0]).toEqual(built.parts[0])
  })

  test("deleting a symbol's geometry drops the part, so nothing wires to a ghost", () => {
    const built = placed()
    const ids = built.entities
      .filter((entity) => entity.id!.startsWith(`${built.parts[0]!.prefix}-`))
      .map((entity) => entity.id!)
    const after = applyOps(built, [{ op: "delete", ids }]).doc
    expect(after.parts.map((part) => part.ref)).toEqual(["R2"])
  })

  test("a deleted reference is not reused by the next placement", () => {
    const built = placed()
    const ids = built.entities
      .filter((entity) => entity.id!.startsWith(`${built.parts[0]!.prefix}-`))
      .map((entity) => entity.id!)
    const gone = applyOps(built, [{ op: "delete", ids }]).doc
    const again = applyOps(gone, [{ op: "place", symbol: "electrical/resistor", at: [90, 20], label: "R3" }]).doc
    expect(again.parts.map((part) => part.prefix)).toEqual([...new Set(again.parts.map((part) => part.prefix))])
  })

  test("an annotated label still gives a plain reference to wire by", () => {
    // `REF | key=value` is the grammar `checkDoc` reads, so an annotated label is ordinary.
    // If the whole string became the reference, annotating a drawing would be what stopped
    // it being wireable — the two conventions have to compose.
    const built = applyOps(doc(), [
      { op: "place", symbol: "iot/esp32-devkit", at: [30, 50], label: "U1 | mA=240, V=3.3" },
      { op: "place", symbol: "iot/led", at: [120, 50], label: "D1 | mA=20" },
    ]).doc
    expect(built.parts.map((part) => part.ref)).toEqual(["U1", "D1"])
    // The full annotation is still drawn on the sheet, for the checker to read.
    expect(built.entities.some((entity) => entity.type === "text" && entity.text === "U1 | mA=240, V=3.3")).toBe(true)
    expect(() => applyOps(built, [{ op: "connect", from: "U1.5", to: "D1.1" }])).not.toThrow()
  })

  test("a web save round-trips parts, which is what makes the two editors one editor", () => {
    // Exactly the web edit route's path: parse the stored metadata with the shared schema,
    // apply ops, serialize. A `parts` array dropped anywhere along here would leave the
    // drawing looking right and silently unwireable.
    const written = serialize(
      applyOps(doc(), [{ op: "place", symbol: "electrical/resistor", at: [20, 20], label: "R1" }]).doc,
    )
    const asWebReadsIt = BlueprintDocSchema.parse(JSON.parse(written))
    expect(asWebReadsIt.parts).toHaveLength(1)
    const afterWebEdit = applyOps(asWebReadsIt, [
      { op: "place", symbol: "electrical/lamp", at: [80, 20], label: "L1" },
    ]).doc
    const backInTheTui = parseDoc(serialize(afterWebEdit))
    expect(backInTheTui.parts.map((part) => part.ref)).toEqual(["R1", "L1"])
    expect(() => applyOps(backInTheTui, [{ op: "connect", from: "R1.2", to: "L1.1" }])).not.toThrow()
  })

  test("an unknown symbol names the way to find a real one", () => {
    expect(() => applyOps(doc(), [{ op: "place", symbol: "flux-capacitor", at: [0, 0] }])).toThrow(/no such symbol/)
  })
})

describe("connect", () => {
  const two = () =>
    applyOps(doc(), [
      { op: "place", symbol: "electrical/resistor", at: [20, 20], label: "R1" },
      { op: "place", symbol: "electrical/resistor", at: [80, 60], label: "R2" },
    ]).doc

  test("a wire runs from one port to the other", () => {
    const before = two()
    const after = applyOps(before, [{ op: "connect", from: "R1.2", to: "R2.1" }]).doc
    const wire = after.entities.find((entity) => entity.id === "w1")
    expect(wire?.type).toBe("polyline")
    if (wire?.type !== "polyline") throw new Error("no wire")
    expect(wire.pts[0]).toEqual(before.parts[0]!.ports[1]!)
    expect(wire.pts.at(-1)).toEqual(before.parts[1]!.ports[0]!)
  })

  test("the wire is orthogonal, which is what makes a schematic readable", () => {
    const after = applyOps(two(), [{ op: "connect", from: "R1.2", to: "R2.1" }]).doc
    const wire = after.entities.find((entity) => entity.id === "w1")
    if (wire?.type !== "polyline") throw new Error("no wire")
    for (let i = 1; i < wire.pts.length; i += 1) {
      const a = wire.pts[i - 1]!
      const b = wire.pts[i]!
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true)
    }
  })

  test("a case-insensitive ref and a label both work", () => {
    const after = applyOps(two(), [{ op: "connect", from: "r1.1", to: "R2.2", label: "W1 | mm2=2.5, A=16" }]).doc
    expect(after.entities.some((entity) => entity.type === "text" && entity.text.startsWith("W1 |"))).toBe(true)
  })

  test("an unknown ref lists the refs that do exist", () => {
    expect(() => applyOps(two(), [{ op: "connect", from: "R9.1", to: "R2.1" }])).toThrow(/R1, R2/)
  })

  test("a port out of range says what the range is", () => {
    expect(() => applyOps(two(), [{ op: "connect", from: "R1.9", to: "R2.1" }])).toThrow(/ports 1\.\./)
  })

  test("an address without a port explains the form", () => {
    expect(() => applyOps(two(), [{ op: "connect", from: "R1", to: "R2.1" }])).toThrow(/REF\.PORT/)
  })

  test("wire ids are their own series, so a hand-drawn entity never collides", () => {
    const after = applyOps(two(), [
      { op: "connect", from: "R1.1", to: "R2.1" },
      { op: "connect", from: "R1.2", to: "R2.2" },
    ]).doc
    expect(after.entities.filter((entity) => /^w\d+$/.test(entity.id ?? "")).map((entity) => entity.id)).toEqual([
      "w1",
      "w2",
    ])
  })

  test("a wire that has to cross a part is drawn anyway, and reported", () => {
    // Three parts in a row: wiring the outer two has to pass the middle one whichever way
    // it goes. Refusing would leave an empty schematic; the warning is the honest answer.
    const crowded = applyOps(doc(), [
      { op: "place", symbol: "electrical/resistor", at: [0, 20], label: "R1" },
      { op: "place", symbol: "electrical/resistor", at: [30, 20], label: "R2" },
      { op: "place", symbol: "electrical/resistor", at: [60, 20], label: "R3" },
    ]).doc
    const result = applyOps(crowded, [{ op: "connect", from: "R1.2", to: "R3.1", layer: "l0" }])
    expect(result.doc.entities.some((entity) => entity.id === "w1")).toBe(true)
    expect(result.warnings.join(" ")).toMatch(/R1\.2→R3\.1/)
  })

  test("a wire ending on another wire's interior gets a junction dot", () => {
    const three = applyOps(doc(), [
      { op: "place", symbol: "electrical/resistor", at: [0, 0], label: "R1" },
      { op: "place", symbol: "electrical/resistor", at: [0, 40], label: "R2" },
      { op: "place", symbol: "electrical/resistor", at: [40, 20], label: "R3" },
    ]).doc
    const wired = applyOps(three, [{ op: "connect", from: "R1.2", to: "R2.2" }]).doc
    const first = wired.entities.find((entity) => entity.id === "w1")
    if (first?.type !== "polyline") throw new Error("no wire")
    // Tap the middle of that wire's first segment — a vertex would be an end, not an
    // interior, and two wires meeting end to end need no dot.
    const midpoint: [number, number] = [
      (first.pts[0]![0] + first.pts[1]![0]) / 2,
      (first.pts[0]![1] + first.pts[1]![1]) / 2,
    ]
    const r3 = wired.parts[2]!
    const ids = wired.entities.filter((entity) => entity.id!.startsWith(`${r3.prefix}-`)).map((entity) => entity.id!)
    const aligned = applyOps(wired, [
      { op: "move", ids, by: [midpoint[0] - r3.ports[0]![0], midpoint[1] - r3.ports[0]![1]] },
    ]).doc
    const tapped = applyOps(aligned, [{ op: "connect", from: "R3.1", to: "R1.1" }]).doc
    expect(tapped.parts.some((part) => part.symbol.endsWith("junction-dot"))).toBe(true)
  })
})

describe("arrange", () => {
  test("a schematic part off the grid is snapped onto it", () => {
    const built = applyOps(doc(), [{ op: "place", symbol: "electrical/resistor", at: [20, 20], label: "R1" }]).doc
    // `place` already snaps, so shift it off by hand to have something to arrange.
    const ids = built.entities.map((entity) => entity.id!)
    const askew = applyOps(built, [{ op: "move", ids, by: [0.7, -0.4] }]).doc
    const tidy = applyOps(askew, [{ op: "arrange" }]).doc
    for (const value of tidy.parts[0]!.at) expect(Math.abs(value / 2.54 - Math.round(value / 2.54))).toBeLessThan(1e-9)
  })

  test("two overlapping parts are pushed apart", () => {
    const stacked = applyOps(doc(), [
      { op: "place", symbol: "electrical/resistor", at: [20, 20], label: "R1" },
      { op: "place", symbol: "electrical/resistor", at: [21, 20], label: "R2" },
    ]).doc
    const tidy = applyOps(stacked, [{ op: "arrange" }]).doc
    const gap = Math.abs(tidy.parts[0]!.at[0] - tidy.parts[1]!.at[0]) + Math.abs(tidy.parts[0]!.at[1] - tidy.parts[1]!.at[1])
    expect(gap).toBeGreaterThan(
      Math.abs(stacked.parts[0]!.at[0] - stacked.parts[1]!.at[0]) +
        Math.abs(stacked.parts[0]!.at[1] - stacked.parts[1]!.at[1]),
    )
  })

  test("a building symbol is left where it was — a door belongs to the wall, not the grid", () => {
    const plan = applyOps(doc(), [{ op: "place", symbol: "building/door-single-left", at: [1000.3, 500.7], label: "D1" }]).doc
    expect(plan.parts[0]!.at).toEqual([1000.3, 500.7])
    const tidy = applyOps(plan, [{ op: "arrange" }]).doc
    expect(tidy.parts[0]!.at).toEqual([1000.3, 500.7])
  })

  test("arranging a tidy drawing changes nothing, so it commits nothing", () => {
    const built = applyOps(doc(), [
      { op: "place", symbol: "electrical/resistor", at: [20, 20], label: "R1" },
      { op: "place", symbol: "electrical/resistor", at: [80, 20], label: "R2" },
    ]).doc
    const again = applyOps(built, [{ op: "arrange" }]).doc
    expect(serialize(again)).toBe(serialize(built))
  })
})
