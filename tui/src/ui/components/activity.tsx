import { describe, type Keymap } from "../../config/keybinds.ts"
import type { Theme } from "../../config/theme.ts"
import { useTicker, type MotionLevel } from "../motion.ts"
import { summarize, type Item } from "../transcript.ts"

/**
 * What is happening right now, shown only while a turn runs. Without it the gap between
 * submitting and the first token is indistinguishable from a hang.
 */
export function Activity({
  items,
  theme,
  motion,
  keymap,
  compacting = false,
}: {
  items: Item[]
  theme: Theme
  motion: MotionLevel
  keymap: Keymap
  /** Summarizing takes a model round trip of its own, so say what the wait is for. */
  compacting?: boolean
}) {
  const { frame, seconds } = useTicker(true, motion)
  const running = items.findLast((item) => item.kind === "tool" && item.output === undefined)

  const parts = compacting
    ? [`compacting history ${seconds}s`]
    : [
        `working ${seconds}s`,
        running?.kind === "tool" ? summarize(running.name, running.input) : undefined,
        `${describe(keymap.interrupt)} to stop`,
      ].filter(Boolean)

  return (
    <box style={{ flexDirection: "row", width: "100%", paddingLeft: 1 }}>
      <text fg={theme.warning}>{`${frame} `}</text>
      <text fg={theme.muted}>{parts.join(" · ")}</text>
    </box>
  )
}
