import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act, useRef } from "react"
import { Editor, type EditorHandle } from "../src/ui/components/editor.tsx"
import { loadKeymap } from "../src/config/keybinds.ts"
import { loadTheme } from "../src/config/theme.ts"

const theme = loadTheme("dark", process.cwd())
const keymap = loadKeymap({})

function Harness({ recording = false, onVoice }: { recording?: boolean; onVoice?: () => void }) {
  const handle = useRef<EditorHandle>(null)
  return (
    <Editor
      theme={theme}
      keymap={keymap}
      motion="off"
      busy={false}
      handle={handle}
      onSubmit={() => {}}
      onChange={() => {}}
      recording={recording}
      onVoice={onVoice}
    />
  )
}

/** The button is the only thing that says voice exists, so what it shows is the feature. */
describe("push-to-talk button", () => {
  test("offers the key, and says so when the mic is live", async () => {
    const { renderer, captureCharFrame, flush } = await testRender(<Harness onVoice={() => {}} />, {
      width: 64,
      height: 5,
    })
    await flush()
    expect(captureCharFrame()).toContain("◉ ctrl+s")
    // The prompt keeps its own column: text must never run under the button.
    expect(captureCharFrame()).toContain("ask jarvis, or / for commands")
    renderer.destroy()

    const live = await testRender(<Harness recording onVoice={() => {}} />, { width: 64, height: 5 })
    await live.flush()
    expect(live.captureCharFrame()).toContain("◉ recording")
    live.renderer.destroy()
  })

  // Advertising a key that can only answer "voice is off" is worse than not mentioning it.
  test("is absent when voice is not configured", async () => {
    const { renderer, captureCharFrame, flush } = await testRender(<Harness />, { width: 64, height: 5 })
    await flush()
    expect(captureCharFrame()).not.toContain("ctrl+s")
    expect(captureCharFrame()).not.toContain("◉")
    renderer.destroy()
  })

  // Ten columns of key hint is a fair trade at 80 and a tenth of the prompt in a tmux pane.
  test("drops to the glyph alone on a narrow terminal", async () => {
    const { renderer, captureCharFrame, flush } = await testRender(<Harness onVoice={() => {}} />, {
      width: 40,
      height: 5,
    })
    await flush()
    expect(captureCharFrame()).toContain("◉")
    expect(captureCharFrame()).not.toContain("ctrl+s")
    renderer.destroy()
  })

  test("clicking it toggles recording, the same as the key", async () => {
    let presses = 0
    const { renderer, mockMouse, flush } = await testRender(<Harness onVoice={() => (presses += 1)} />, {
      width: 64,
      height: 5,
    })
    await flush()
    // Row 1 is the prompt line; the button ends one column short of the right edge.
    await act(async () => await mockMouse.click(56, 1))
    await flush()
    expect(presses).toBe(1)
    renderer.destroy()
  })
})
