import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, compose, rotate, translate } from "../src/blueprint/geom.ts"
import { EntitySchema, emptyDoc, seqOf, type Pt } from "../src/blueprint/schema.ts"
import { ensureRepo, readDoc, writeDoc } from "../src/blueprint/store.ts"
import { blueprintSymbolTool } from "../src/blueprint/symbol-tool.ts"
import { DOMAINS, findSymbol, LIBRARIES, searchSymbols } from "../src/blueprint/symbols/index.ts"
import { constantAsker, PermissionGate } from "../src/permission.ts"
import type { ToolContext } from "../src/tools/context.ts"

function setup() {
  const root = mkdtempSync(join(tmpdir(), "jarvis-symbols-"))
  ensureRepo(root)
  writeDoc(root, "sheet", emptyDoc("sheet"), "create")
  const ctx = {
    cwd: root,
    worktree: root,
    blueprints: root,
    gate: new PermissionGate({}, constantAsker(true)),
    read: new Map<string, number>(),
    depth: 0,
    agent: "build",
    sessionID: "test",
  } satisfies ToolContext
  return { root, tool: blueprintSymbolTool(ctx, root) }
}

const call = async (tool: unknown, input: unknown) =>
  (await (tool as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(input, {})) as string

describe("symbol libraries", () => {
  test("every entity in every symbol is a valid entity", () => {
    for (const domain of DOMAINS) {
      for (const [name, symbol] of Object.entries(LIBRARIES[domain])) {
        expect(symbol.entities.length, `${domain}/${name} is empty`).toBeGreaterThan(0)
        expect(symbol.describe.length, `${domain}/${name} has no description`).toBeGreaterThan(0)
        for (const entity of symbol.entities) {
          const parsed = EntitySchema.safeParse(entity)
          expect(parsed.success, `${domain}/${name}: ${parsed.error?.issues[0]?.message}`).toBe(true)
        }
      }
    }
  })

  test("no symbol ships with an id or a layer baked in", () => {
    // Both are assigned at placement; one left behind would collide on the second place.
    for (const domain of DOMAINS) {
      for (const [name, symbol] of Object.entries(LIBRARIES[domain])) {
        for (const entity of symbol.entities) {
          expect(entity.id, `${domain}/${name}`).toBeUndefined()
          expect(entity.layer, `${domain}/${name}`).toBeUndefined()
        }
      }
    }
  })

  test("lookup takes a bare or a qualified name", () => {
    expect(findSymbol("electrical/resistor")?.domain).toBe("electrical")
    expect(findSymbol("resistor")?.domain).toBe("electrical")
    expect(findSymbol("door-single-left")?.domain).toBe("building")
    expect(findSymbol("nope")).toBeUndefined()
  })

  test("search narrows on every term, not any", () => {
    const both = searchSymbols({ query: "three phase" })
    expect(both.length).toBeGreaterThan(0)
    expect(both.every((entry) => /three/i.test(JSON.stringify(entry)) && /phase/i.test(JSON.stringify(entry)))).toBe(true)
    expect(searchSymbols({ domain: "building", query: "resistor" })).toHaveLength(0)
  })
})

describe("blueprint_symbol", () => {
  test("list finds a symbol and reports its port count", async () => {
    const { tool } = setup()
    const output = await call(tool, { action: "list", domain: "electrical", query: "resistor" })
    expect(output).toContain("electrical/resistor")
    expect(output).toContain("2 ports")
    expect(output).toContain("IEC 60617")
  })

  test("places a symbol and reports transformed ports", async () => {
    const { root, tool } = setup()
    const output = await call(tool, {
      action: "place",
      name: "sheet",
      placements: [{ symbol: "electrical/resistor", at: [100, 50], label: "R1" }],
    })
    // Reported by reference, not by coordinate: `connect` takes the names, and nobody has
    // to copy a port position back out of the transcript any more.
    expect(output).toContain("R1  electrical/resistor")
    expect(output).toContain("connect with R1.1..R1.2")

    const doc = readDoc(root, "sheet")
    expect(doc.entities.every((entity) => entity.id!.startsWith("r1-"))).toBe(true)
    expect(doc.entities.some((entity) => entity.type === "text" && entity.text === "R1")).toBe(true)

    // The part is remembered, snapped to the 2.54 grid, with its ports in document space.
    const part = doc.parts.find((candidate) => candidate.ref === "R1")!
    expect(part.at).toEqual([99.06, 50.8])
    // A resistor's ports are ±10.16 along its own X.
    expect(part.ports).toEqual([
      [88.9, 50.8],
      [109.22, 50.8],
    ])
  })

  test("accepts a single symbol flattened to top-level fields", async () => {
    const { root, tool } = setup()
    const output = await call(tool, {
      action: "place",
      name: "sheet",
      symbol: "electrical/resistor",
      at: [100, 50],
      label: "R1",
    })
    expect(output).toContain("R1  electrical/resistor")
    expect(output).toContain("connect with R1.1..R1.2")

    const doc = readDoc(root, "sheet")
    expect(doc.entities.every((entity) => entity.id!.startsWith("r1-"))).toBe(true)
    expect(doc.entities.some((entity) => entity.type === "text" && entity.text === "R1")).toBe(true)
  })

  test("rotation lands the ports where the matrix says", async () => {
    const { root, tool } = setup()
    // Already on the 2.54 grid, so snapping leaves it alone and the matrix is the only
    // thing moving the ports.
    const at: Pt = [40.64, 60.96]
    await call(tool, {
      action: "place",
      name: "sheet",
      placements: [{ symbol: "electrical/resistor", at, rotate: 90, label: "R9" }],
    })
    const part = readDoc(root, "sheet").parts.find((candidate) => candidate.ref === "R9")!
    expect(part.at).toEqual(at)
    const expected = apply(compose(translate(at[0], at[1]), rotate(90)), [10.16, 0])
    expect(part.ports[1]![0]).toBeCloseTo(expected[0], 6)
    expect(part.ports[1]![1]).toBeCloseTo(expected[1], 6)
    // 90° clockwise with Y down sends +X to +Y: the far port ends up below the origin.
    expect(expected[1]).toBeGreaterThan(at[1])
  })

  test("ids never start with `e`, which would poison the id counter", async () => {
    const { root, tool } = setup()
    // A label that would otherwise produce `e5-…` and be parsed as entity number 5.
    await call(tool, { action: "place", name: "sheet", placements: [{ symbol: "resistor", at: [0, 0], label: "E5" }] })
    const doc = readDoc(root, "sheet")
    expect(doc.entities.every((entity) => !/^e\d/.test(entity.id!))).toBe(true)
    expect(seqOf(doc)).toBe(0)
  })

  test("placing the same symbol twice does not collide", async () => {
    const { root, tool } = setup()
    await call(tool, {
      action: "place",
      name: "sheet",
      placements: [
        { symbol: "resistor", at: [0, 0] },
        { symbol: "resistor", at: [40, 0] },
      ],
    })
    const doc = readDoc(root, "sheet")
    expect(new Set(doc.entities.map((entity) => entity.id)).size).toBe(doc.entities.length)
  })

  test("an unknown symbol is an error, and nothing is written", async () => {
    const { root, tool } = setup()
    const before = readDoc(root, "sheet").entities.length
    // Asserted on the message, not the class: the throw comes from `applyOps` as a
    // `BlueprintError` now that placement is an op, and what matters to the model is that
    // it is told how to find a real symbol name.
    expect(
      call(tool, { action: "place", name: "sheet", placements: [{ symbol: "flux-capacitor", at: [0, 0] }] }),
    ).rejects.toThrow(/no such symbol: flux-capacitor/)
    expect(readDoc(root, "sheet").entities).toHaveLength(before)
  })
})
