import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { Messages } from "../src/ui/components/messages.tsx"
import { loadTheme } from "../src/config/theme.ts"
import type { Item } from "../src/ui/transcript.ts"

const items: Item[] = [{ kind: "reasoning", text: "first thought\nsecond thought" }]
const theme = loadTheme("dark", process.cwd())

/** The click is the whole feature, and only a real renderer can say whether it lands. */
describe("thinking blocks", () => {
  test("open on a click and fold again on the next one", async () => {
    const { renderer, mockMouse, captureCharFrame, flush } = await testRender(
      <Messages items={items} theme={theme} motion="off" streaming={false} thinking={false} />,
      { width: 60, height: 12 },
    )

    await flush()
    expect(captureCharFrame()).toContain("▸ thinking · 2 lines")
    expect(captureCharFrame()).not.toContain("second thought")

    // Row 0, past the two-space indent: the header line of the only block on screen.
    await act(async () => await mockMouse.click(4, 0))
    await flush()
    expect(captureCharFrame()).toContain("▾ thinking")
    expect(captureCharFrame()).toContain("second thought")

    await act(async () => await mockMouse.click(4, 0))
    await flush()
    expect(captureCharFrame()).not.toContain("second thought")

    renderer.destroy()
  })
})
