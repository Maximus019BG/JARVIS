import { describe, expect, test } from "bun:test"
import { bbox, flatten, rotate, transform, translate } from "../src/blueprint/geom.ts"
import { applyOps } from "../src/blueprint/ops.ts"
import { autoView, renderBraille } from "../src/blueprint/render-braille.ts"
import { toSvg } from "../src/blueprint/render-svg.ts"
import { BlueprintError, emptyDoc, parseDoc, seqOf, serialize, type BlueprintDoc } from "../src/blueprint/schema.ts"

const doc = (): BlueprintDoc => emptyDoc("plate")

const withEntities = (...ops: Parameters<typeof applyOps>[1]) => applyOps(doc(), ops).doc

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

  test("braille lists text entities it cannot draw", () => {
    const built = withEntities({ op: "add", entity: { type: "text", at: [5, 5], text: "M6" } })
    expect(renderBraille(built, { cols: 20, rows: 4 }).join("\n")).toContain('"M6"')
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
