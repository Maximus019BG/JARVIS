import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { loadTheme } from "../src/config/theme.ts"
import { Projection, SIDE } from "../src/ui/components/projection.tsx"

const theme = loadTheme("dark", process.cwd())

test("the projector view keeps the side panel and footer, and lights spots only left of the panel", async () => {
  const { renderer, captureCharFrame, flush } = await testRender(
    <Projection
      spots={[{ box: { x: 0.9, y: 0, w: 0.1, h: 0.2 }, rgb: [255, 0, 0], label: "mug" }]}
      side={<text>items</text>}
      status="2/2 in view"
      keys="a all · esc/q close"
      colour={theme.dim}
      theme={theme}
    />,
    { width: 80, height: 20 },
  )
  await flush()
  const lines = captureCharFrame().split("\n")
  expect(lines[0]!.slice(80 - SIDE)).toContain("items")
  // A spot at the right edge of the picture still ends before the panel starts.
  expect(lines[1]!.slice(0, 80 - SIDE)).toContain("┃")
  expect(lines[1]!.slice(80 - SIDE)).not.toContain("┃")
  expect(lines[18]).toContain("2/2 in view")
  expect(lines[19]).toContain("esc/q close")
  renderer.destroy()
})
