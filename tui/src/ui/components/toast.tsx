import type { BoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useCallback, useRef, useState } from "react"
import type { Theme } from "../../config/theme.ts"
import { useEnter, type MotionLevel } from "../motion.ts"
import { clip } from "./dialog.tsx"

export type ToastLevel = "info" | "warn" | "error"
export type Toast = { id: number; text: string; level: ToastLevel }

/**
 * How long each level stays up. An error that vanishes before it is read is worse than no
 * error at all, so it gets the longest window.
 */
const LINGER_MS: Record<ToastLevel, number> = { info: 3000, warn: 5000, error: 8000 }

/** Glyph and theme token per level, matching the transcript's `✓`/`✗` vocabulary. */
const MARK: Record<ToastLevel, { glyph: string; tone: keyof Theme }> = {
  info: { glyph: "●", tone: "accent" },
  warn: { glyph: "!", tone: "warning" },
  error: { glyph: "✗", tone: "error" },
}

/** Older toasts fall off the bottom rather than growing a wall over the transcript. */
const MAX = 3

/**
 * Transient messages, for anything the user should see now but should not have to scroll the
 * transcript to find. Notes are the other half of this: a note is a permanent record of what
 * happened during a turn, a toast is a nudge that expires on its own.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(0)

  const toast = useCallback((text: string, level: ToastLevel = "info") => {
    const id = next.current++
    setToasts((current) => [...current, { id, text, level }].slice(-MAX))
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), LINGER_MS[level])
  }, [])

  return { toasts, toast }
}

function Card({ toast, theme, motion }: { toast: Toast; theme: Theme; motion: MotionLevel }) {
  const box = useRef<BoxRenderable>(null)
  const { width: columns } = useTerminalDimensions()
  const { glyph, tone } = MARK[toast.level]
  const color = theme[tone]
  useEnter(box, motion, { ms: 140 })

  return (
    <box
      ref={box}
      style={{
        border: true,
        borderColor: color,
        backgroundColor: theme.panel,
        flexDirection: "row",
        // Wide enough to say something, never wide enough to cover the transcript.
        maxWidth: Math.max(24, Math.min(56, columns - 4)),
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={color}>{`${glyph} `}</text>
      <text fg={theme.fg}>{clip(toast.text, Math.max(20, Math.min(52, columns - 8)))}</text>
    </box>
  )
}

/**
 * Floats the stack over the bottom-right corner, clear of the status line. `zIndex` sits
 * under the picker's 100 so a toast never lands on top of a dialog the user is answering.
 */
export function Toasts({ toasts, theme, motion }: { toasts: Toast[]; theme: Theme; motion: MotionLevel }) {
  if (toasts.length === 0) return null

  return (
    <box
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "flex-end",
        paddingRight: 1,
        // One row for the status line, one for breathing space.
        paddingBottom: 2,
        zIndex: 50,
      }}
    >
      {toasts.map((entry) => (
        <Card key={entry.id} toast={entry} theme={theme} motion={motion} />
      ))}
    </box>
  )
}
