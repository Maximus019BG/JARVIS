import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { Messages } from "../src/ui/components/messages.tsx"
import { loadTheme } from "../src/config/theme.ts"
import type { Item } from "../src/ui/transcript.ts"

const items: Item[] = [{ kind: "reasoning", text: "first thought\nsecond thought" }]
const patch = ["--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,2 @@", " keep", "-was here", "+is here now"].join("\n")
const edited: Item[] = [
  { kind: "tool", id: "c1", name: "edit", input: { filePath: "a.ts" }, output: "edited a.ts", startedAt: 0, endedAt: 0, patch },
]
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

/**
 * The diff a tool showed the approval prompt, kept on its card. Without a real renderer
 * there is nothing to say whether the fold opens, which is the entire feature.
 */
describe("tool diffs", () => {
  test("fold open on a click and closed on the next one", async () => {
    const { renderer, mockMouse, captureCharFrame, flush } = await testRender(
      <Messages items={edited} theme={theme} motion="off" streaming={false} thinking={false} />,
      { width: 60, height: 12 },
    )

    await flush()
    // The counts are the header, so what changed is legible without opening anything.
    expect(captureCharFrame()).toContain("+1 −1")
    expect(captureCharFrame()).not.toContain("is here now")

    await act(async () => await mockMouse.click(4, 0))
    await flush()
    expect(captureCharFrame()).toContain("is here now")

    await act(async () => await mockMouse.click(4, 0))
    await flush()
    expect(captureCharFrame()).not.toContain("is here now")

    renderer.destroy()
  })

  test("a tool with no diff has nothing to click and says nothing about one", async () => {
    const plain: Item[] = [{ kind: "tool", id: "c2", name: "read", input: {}, output: "ok", startedAt: 0, endedAt: 0 }]
    const { renderer, captureCharFrame, flush } = await testRender(
      <Messages items={plain} theme={theme} motion="off" streaming={false} thinking={false} />,
      { width: 60, height: 8 },
    )
    await flush()
    expect(captureCharFrame()).not.toContain("+0")
    expect(captureCharFrame()).toContain("read")
    renderer.destroy()
  })
})
