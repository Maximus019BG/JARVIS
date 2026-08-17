import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyOps } from "../src/blueprint/ops.ts"
import { BlueprintError, emptyDoc } from "../src/blueprint/schema.ts"
import {
  blueprintRoot,
  deleteDoc,
  docAt,
  ensureRepo,
  exists,
  history,
  listBlueprints,
  readDoc,
  safeName,
  writeDoc,
} from "../src/blueprint/store.ts"

function store() {
  const root = mkdtempSync(join(tmpdir(), "jarvis-blueprints-"))
  ensureRepo(root)
  return root
}

const seed = (root: string, name = "plate") => writeDoc(root, name, emptyDoc(name), "create")

describe("safeName", () => {
  test("accepts ordinary names and strips the suffix", () => {
    expect(safeName("plate")).toBe("plate")
    expect(safeName("mount-bracket-2")).toBe("mount-bracket-2")
    expect(safeName("plate.blueprint.json")).toBe("plate")
    expect(safeName("  plate  ")).toBe("plate")
  })

  test("suggests the corrected name, since the usual mistake is mechanical", () => {
    // What the model actually sent in the wild: an underscore. Restating the rule left it
    // guessing; handing it the fixed name does not.
    expect(() => safeName("simple_electrical")).toThrow(/try "simple-electrical"/)
    expect(() => safeName("My Plate")).toThrow(/try "my-plate"/)
    // Nothing salvageable, so no misleading suggestion.
    expect(() => safeName("../..")).toThrow(/use lowercase letters/)
    expect(() => safeName("../..")).not.toThrow(/try "/)
  })

  test("rejects anything that could escape the store", () => {
    // This is the whole path-traversal defence — these tools never see resolvePath.
    for (const bad of [
      "../escape",
      "../../etc/passwd",
      "/etc/passwd",
      "a/b",
      "a\\b",
      "a b",
      "",
      "  ",
      "-leading",
      "Upper",
      "plate$",
      "x".repeat(65),
    ]) {
      expect(() => safeName(bad)).toThrow(BlueprintError)
    }
  })
})

describe("store", () => {
  test("writeDoc makes exactly one commit", () => {
    const root = store()
    const sha = seed(root)
    expect(sha).toMatch(/^[0-9a-f]{7,}$/)
    expect(history(root, "plate")).toHaveLength(1)
    expect(exists(root, "plate")).toBe(true)
  })

  test("a no-op write does not create an empty commit", () => {
    const root = store()
    seed(root)
    const again = writeDoc(root, "plate", readDoc(root, "plate"), "nothing changed")
    expect(history(root, "plate")).toHaveLength(1)
    expect(again).toMatch(/^[0-9a-f]{7,}$/)
  })

  test("docAt returns the document as it was before the last edit", () => {
    const root = store()
    seed(root)
    const edited = applyOps(readDoc(root, "plate"), [
      { op: "add", entity: { type: "line", a: [0, 0], b: [10, 0] } },
    ]).doc
    writeDoc(root, "plate", edited, "add a line")

    const log = history(root, "plate")
    expect(log).toHaveLength(2)
    expect(readDoc(root, "plate").entities).toHaveLength(1)
    expect(docAt(root, "plate", log[1]!.sha).entities).toHaveLength(0)
  })

  test("commit messages carry the blueprint name and the op summary", () => {
    const root = store()
    seed(root)
    writeDoc(root, "plate", applyOps(readDoc(root, "plate"), [
      { op: "add", entity: { type: "circle", c: [0, 0], r: 3 } },
    ]).doc, "add circle")
    expect(history(root, "plate")[0]!.message).toBe("plate: add circle")
  })

  test("listBlueprints reports entity counts and the head commit", () => {
    const root = store()
    seed(root, "plate")
    seed(root, "bracket")
    writeDoc(root, "plate", applyOps(readDoc(root, "plate"), [
      { op: "add", entity: { type: "line", a: [0, 0], b: [1, 1] } },
    ]).doc, "add line")

    const listed = listBlueprints(root)
    expect(listed.map((item) => item.name)).toEqual(["bracket", "plate"])
    expect(listed.find((item) => item.name === "plate")).toMatchObject({ entities: 1, layers: 1 })
    expect(listed[0]!.head).toMatch(/^[0-9a-f]{7,}$/)
  })

  test("listBlueprints still lists a file that will not parse", () => {
    const root = store()
    seed(root)
    Bun.write(join(root, "broken.blueprint.json"), "{ not json")
    const listed = listBlueprints(root)
    expect(listed.map((item) => item.name)).toContain("broken")
    expect(listed.find((item) => item.name === "broken")!.entities).toBe(0)
  })

  test("reading something that is not there says so", () => {
    const root = store()
    expect(() => readDoc(root, "ghost")).toThrow(/no blueprint named/)
    // The message has to say how to recover, or an agent that guessed a name guesses again.
    expect(() => readDoc(root, "ghost")).toThrow(/create it first with blueprint action:"create"/)
    seed(root, "plate")
    expect(() => readDoc(root, "ghost")).toThrow(/use an existing one: plate/)
    expect(exists(root, "ghost")).toBe(false)
  })

  test("delete removes the file and records it in history", () => {
    const root = store()
    seed(root)
    deleteDoc(root, "plate")
    expect(exists(root, "plate")).toBe(false)
    expect(listBlueprints(root)).toHaveLength(0)
    expect(() => deleteDoc(root, "plate")).toThrow(/no blueprint named/)
  })

  test("an empty store lists nothing rather than failing", () => {
    expect(listBlueprints(join(tmpdir(), "jarvis-nonexistent-store"))).toEqual([])
  })
})

describe("blueprintRoot", () => {
  const base = { workspace: "default" } as const

  test("defaults under the data dir, keyed by workspace", () => {
    expect(blueprintRoot({ blueprint: base } as never)).toMatch(/blueprints[/\\]default$/)
    expect(blueprintRoot({ blueprint: { workspace: "shop" } } as never)).toMatch(/blueprints[/\\]shop$/)
  })

  test("config.blueprint.dir wins", () => {
    expect(blueprintRoot({ blueprint: { ...base, dir: "/tmp/bp" } } as never)).toBe("/tmp/bp")
  })
})
