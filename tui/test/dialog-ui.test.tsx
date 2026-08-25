import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { loadTheme } from "../src/config/theme.ts"
import { Picker, wrapText } from "../src/ui/components/dialog.tsx"

const theme = loadTheme("dark", process.cwd())

/** Key presses, awaited. Named keys go in as their `KeyCodes` name — `"escape"` would type
 *  the six letters. Mirrors the helper in blueprint-ui.test.tsx. */
type MockInput = { pressKey: (key: string) => unknown; typeText: (text: string) => Promise<void> }
const presser = (mockInput: MockInput, flush: () => Promise<void>) => async (key: string) => {
  await act(async () => {
    await mockInput.pressKey(key)
    // A lone ESC is held back in case more bytes turn it into an escape sequence, so without
    // a beat here it arrives merged into the next key rather than as escape.
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
  await flush()
}

/** Three answers, no hints — the shape the `ask` tool produces. */
const CHOICES = ["millimetres", "inches", "whatever the file already uses"].map((option) => ({
  value: option,
  label: option,
}))

describe("wrapText", () => {
  test("breaks on spaces and never exceeds the width", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", 12)
    expect(lines.every((line) => line.length <= 12)).toBe(true)
    expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog")
  })

  test("breaks a word too long to fit rather than overflowing", () => {
    expect(wrapText("supercalifragilistic", 8)).toEqual(["supercal", "ifragili", "stic"])
  })
})

describe("question picker", () => {
  test("shows every option and the whole question", async () => {
    const { renderer, captureCharFrame, flush } = await testRender(
      <Picker
        title="question"
        prompt="Which units should the bracket be dimensioned in?"
        choices={CHOICES}
        theme={theme}
        motion="off"
        allowOther
        onPick={() => {}}
        onCancel={() => {}}
      />,
      { width: 60, height: 24 },
    )
    await flush()
    const frame = captureCharFrame()
    // The bug this test exists for: a hintless list was sized at one line an entry while the
    // renderable spent two, so everything past the first option fell outside the box.
    for (const choice of CHOICES) expect(frame).toContain(choice.label)
    expect(frame).toContain("Other")
    // The question itself, wrapped over two lines rather than clipped to the title.
    expect(frame).toContain("dimensioned")
    expect(frame).toContain("in?")
    renderer.destroy()
  })

  test("Other opens a field and sends what was typed", async () => {
    const picked: string[] = []
    const { renderer, mockInput, captureCharFrame, flush } = await testRender(
      <Picker
        title="question"
        prompt="Which units?"
        choices={CHOICES}
        theme={theme}
        motion="off"
        allowOther
        onPick={(value) => picked.push(value)}
        onCancel={() => {}}
      />,
      { width: 60, height: 24 },
    )
    await flush()
    const press = presser(mockInput, flush)

    // Past the three options to `Other…`, which is always last.
    for (let i = 0; i < CHOICES.length; i++) await press("ARROW_DOWN")
    await press("RETURN")
    expect(captureCharFrame()).toContain("enter send")

    await act(async () => {
      await mockInput.typeText("cubits")
    })
    await flush()
    // Empty is the tool's dismissal sentinel, so an empty field must not submit.
    expect(picked).toEqual([])

    await press("RETURN")
    expect(picked).toEqual(["cubits"])
    renderer.destroy()
  })

  test("escape from the field goes back to the list, not out of the dialog", async () => {
    let cancelled = false
    const { renderer, mockInput, captureCharFrame, flush } = await testRender(
      <Picker
        title="question"
        choices={CHOICES}
        theme={theme}
        motion="off"
        allowOther
        onPick={() => {}}
        onCancel={() => {
          cancelled = true
        }}
      />,
      { width: 60, height: 24 },
    )
    await flush()
    const press = presser(mockInput, flush)

    for (let i = 0; i < CHOICES.length; i++) await press("ARROW_DOWN")
    await press("RETURN")
    await press("ESCAPE")
    expect(cancelled).toBe(false)
    expect(captureCharFrame()).toContain("millimetres")
    renderer.destroy()
  })
})
