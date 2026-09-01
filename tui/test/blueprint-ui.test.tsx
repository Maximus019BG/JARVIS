import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { act } from "react"
import { applyOps } from "../src/blueprint/ops.ts"
import { emptyDoc, parseDoc } from "../src/blueprint/schema.ts"
import { ensureRepo, readDoc, writeDoc } from "../src/blueprint/store.ts"
import { loadTheme } from "../src/config/theme.ts"
import { BlueprintEditor } from "../src/ui/components/blueprint-editor.tsx"
import { BlueprintPane } from "../src/ui/components/blueprint-view.tsx"

const theme = loadTheme("dark", process.cwd())

/**
 * Key presses, awaited.
 *
 * A plain string is typed as text — `pressKey("escape")` sends the six letters e-s-c-a-p-e
 * — so a named key goes in as its `KeyCodes` name and modifiers as the second argument.
 * Wrapped once here so no test has to remember which is which.
 */
type MockInput = { pressKey: (key: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => unknown }
const presser =
  (mockInput: MockInput, flush: () => Promise<void>) =>
  async (key: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => {
    await act(async () => {
      await mockInput.pressKey(key, modifiers)
    })
    await flush()
  }

/** A store with one small schematic in it: two parts, wired. */
function store() {
  const root = mkdtempSync(join(tmpdir(), "jarvis-bp-ui-"))
  ensureRepo(root)
  const built = applyOps(emptyDoc("circuit"), [
    { op: "addLayer", layer: { name: "power", color: "#ff0000" } },
    { op: "place", symbol: "electrical/resistor", at: [20, 20], label: "R1" },
    { op: "place", symbol: "electrical/lamp", at: [80, 60], label: "L1" },
  ]).doc
  const wired = applyOps(built, [{ op: "connect", from: "R1.2", to: "L1.1", layer: "l1" }]).doc
  writeDoc(root, "circuit", wired, "setup")
  return root
}

describe("blueprint pane", () => {
  test("draws the blueprint, its name and what is in it", async () => {
    const root = store()
    const { renderer, captureCharFrame, flush } = await testRender(
      <BlueprintPane root={root} name="circuit" revision={0} theme={theme} width={44} height={24} />,
      { width: 44, height: 24 },
    )
    await flush()
    const frame = captureCharFrame()
    expect(frame).toContain("circuit")
    // The labels are drawn into the picture, which is the point of the renderer change.
    expect(frame).toContain("R1")
    expect(frame).toContain("L1")
    expect(frame).toContain("2 parts")
    // Braille means something was actually drawn, not just captioned.
    expect(/[⠁-⣿]/.test(frame)).toBe(true)
    renderer.destroy()
  })

  test("a broken file shows its error rather than an empty box", async () => {
    const root = store()
    writeFileSync(join(root, "circuit.blueprint.json"), '{"schema": 1, "name": "circuit"}')
    const { renderer, captureCharFrame, flush } = await testRender(
      <BlueprintPane root={root} name="circuit" revision={0} theme={theme} width={44} height={16} />,
      { width: 44, height: 16 },
    )
    await flush()
    // The parse error, not a blank box — how a reader finds out the file is broken.
    expect(captureCharFrame()).toContain("circuit:")
    renderer.destroy()
  })
})

describe("blueprint editor", () => {
  test("opens on the drawing with the shared tool set", async () => {
    const root = store()
    const { renderer, captureCharFrame, flush } = await testRender(
      <BlueprintEditor root={root} name="circuit" theme={theme} onClose={() => {}} />,
      { width: 120, height: 30 },
    )
    await flush()
    const frame = captureCharFrame()
    // Same tools and same keys as the web toolbar, from `draw.ts`.
    expect(frame).toContain("Select")
    expect(frame).toContain("Rectangle")
    expect(frame).toContain("Freehand")
    expect(frame).toContain("connect")
    expect(frame).toContain("layers")
    expect(frame).toContain("2 parts")
    // The cursor: without it there is no way to tell where the next click lands.
    expect(frame).toContain("┼")
    renderer.destroy()
  })

  test("draws a rectangle, undoes it, redoes it, and saves it to git", async () => {
    const root = store()
    const before = readDoc(root, "circuit").entities.length
    const { renderer, mockInput, captureCharFrame, flush } = await testRender(
      <BlueprintEditor root={root} name="circuit" theme={theme} onClose={() => {}} />,
      { width: 120, height: 30 },
    )
    await flush()

    const press = presser(mockInput, flush)

    await press("r") // rectangle tool
    await press("RETURN") // first corner at the cursor
    await press("ARROW_RIGHT")
    await press("ARROW_RIGHT")
    await press("ARROW_DOWN")
    await press("RETURN") // second corner
    expect(captureCharFrame()).toContain("1 unsaved")

    await press("u")
    expect(captureCharFrame()).toContain("saved")
    await press("r", { ctrl: true })
    expect(captureCharFrame()).toContain("1 unsaved")

    await press("w")
    expect(readDoc(root, "circuit").entities).toHaveLength(before + 1)
    expect(captureCharFrame()).toContain("saved")
    renderer.destroy()
  })

  test("places a symbol, which records a part the way the agent's placement does", async () => {
    const root = store()
    const { renderer, mockInput, captureCharFrame, flush } = await testRender(
      <BlueprintEditor root={root} name="circuit" theme={theme} onClose={() => {}} />,
      { width: 120, height: 30 },
    )
    await flush()
    const press = presser(mockInput, flush)

    await press("s")
    expect(captureCharFrame()).toContain("symbol:")
    for (const letter of "capacitor") await press(letter)
    expect(captureCharFrame()).toContain("electrical/capacitor")
    await press("RETURN")
    await press("w")

    const saved = readDoc(root, "circuit")
    expect(saved.parts).toHaveLength(3)
    expect(saved.parts.at(-1)!.symbol).toContain("capacitor")
    // The record survives serialization, so the web editor sees the same part.
    expect(parseDoc(JSON.stringify(saved)).parts).toHaveLength(3)
    renderer.destroy()
  })

  test("wires two ports with no coordinate typed by anyone", async () => {
    const root = store()
    const { renderer, mockInput, captureCharFrame, flush } = await testRender(
      <BlueprintEditor root={root} name="circuit" theme={theme} onClose={() => {}} />,
      { width: 120, height: 30 },
    )
    await flush()
    const press = presser(mockInput, flush)

    await press("n")
    expect(captureCharFrame()).toContain("press enter")
    // The cursor starts at the origin, so the nearest port is R1's — enter takes it, and
    // enter again takes whatever is nearest after that.
    await press("RETURN")
    expect(captureCharFrame()).toMatch(/from R1\.\d/)
    for (let i = 0; i < 20; i += 1) await press("ARROW_RIGHT")
    for (let i = 0; i < 20; i += 1) await press("ARROW_DOWN")
    await press("RETURN")
    await press("w")

    const saved = readDoc(root, "circuit")
    const wires = saved.entities.filter((entity) => /^w\d+$/.test(entity.id ?? ""))
    expect(wires.length).toBeGreaterThan(1)
    renderer.destroy()
  })

  test("q closes it", async () => {
    const root = store()
    let closed = false
    const { renderer, mockInput, flush } = await testRender(
      <BlueprintEditor root={root} name="circuit" theme={theme} onClose={() => (closed = true)} />,
      { width: 120, height: 30 },
    )
    await flush()
    // `q`, not escape: a bare ESC byte is held back by the key parser until it can rule
    // out an arrow-key sequence, so the harness never delivers it.
    await presser(mockInput, flush)("q")
    expect(closed).toBe(true)
    renderer.destroy()
  })
})
