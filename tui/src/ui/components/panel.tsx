import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useRef } from "react"
import type { Theme } from "../../config/theme.ts"
import { useEnter, type MotionLevel } from "../motion.ts"
import { Modal } from "./dialog.tsx"

/** One line of panel body, and the theme token it is drawn in. */
export type Line = { text: string; tone?: keyof Theme }

export type PanelContent = { title: string; lines: Line[] }

/** How wide a panel is at a given terminal width. Content is built against this. */
export const panelWidth = (columns: number): number => Math.max(40, Math.min(84, columns - 4))
/** Columns a panel's body actually gets: the border and padding cost two each. */
export const panelBody = (columns: number): number => panelWidth(columns) - 4

/**
 * A read-only scrollable overlay. Everything that wants to show more text than a transcript
 * line comfortably holds goes through here rather than growing its own component — the
 * tutorial and `/provider` differ only in the lines they hand over.
 */
export function Panel({
  content,
  theme,
  motion,
  onClose,
}: {
  content: PanelContent
  theme: Theme
  motion: MotionLevel
  onClose: () => void
}) {
  const box = useRef<BoxRenderable>(null)
  const body = useRef<ScrollBoxRenderable>(null)
  const { width: columns, height: rows } = useTerminalDimensions()

  useKeyboard((key) => {
    // Any way out a reader is likely to reach for, since the panel owns the keyboard. Not
    // ctrl+c: that is quit, and app.tsx claims it before any overlay sees it.
    if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "g")) onClose()
    else if (key.name === "u" && key.ctrl) body.current?.scrollBy({ x: 0, y: -8 })
    else if (key.name === "d" && key.ctrl) body.current?.scrollBy({ x: 0, y: 8 })
    else if (key.name === "pageup") body.current?.scrollBy({ x: 0, y: -10 })
    else if (key.name === "pagedown") body.current?.scrollBy({ x: 0, y: 10 })
    else if (key.name === "up") body.current?.scrollBy({ x: 0, y: -2 })
    else if (key.name === "down") body.current?.scrollBy({ x: 0, y: 2 })
  })

  const height = Math.max(10, Math.floor(rows * 0.85))
  useEnter(box, motion, { ms: 140, height })

  return (
    <Modal>
      <box
        ref={box}
        title={content.title}
        titleColor={theme.accent}
        bottomTitle="↑↓ ctrl+u/ctrl+d scroll · esc close"
        style={{
          border: true,
          borderStyle: "rounded",
          borderColor: theme.accent,
          backgroundColor: theme.panel,
          flexDirection: "column",
          height,
          width: panelWidth(columns),
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <scrollbox
          ref={body}
          style={{
            flexGrow: 1,
            rootOptions: { backgroundColor: theme.panel },
            viewportOptions: { backgroundColor: theme.panel },
            contentOptions: { backgroundColor: theme.panel },
            scrollbarOptions: { trackOptions: { foregroundColor: theme.border, backgroundColor: theme.panel } },
          }}
        >
          {content.lines.map((line, index) => (
            <text key={index} fg={theme[line.tone ?? "muted"]}>
              {line.text}
            </text>
          ))}
        </scrollbox>
      </box>
    </Modal>
  )
}
