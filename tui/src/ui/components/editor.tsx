import type { BoxRenderable, TextareaRenderable } from "@opentui/core"
import { useImperativeHandle, useRef, type Ref } from "react"
import type { Keymap } from "../../config/keybinds.ts"
import { describe } from "../../config/keybinds.ts"
import type { Theme } from "../../config/theme.ts"
import { lerpHex, useOscillator, type MotionLevel } from "../motion.ts"

/** One breath of the busy border, slow enough to read as waiting rather than blinking. */
const BREATH_MS = 1400

export type EditorHandle = {
  /** Current text, for submitting or for computing completions. */
  text: () => string
  clear: () => void
  /** Replaces the whole buffer, used when a picker inserts a completion. */
  set: (text: string) => void
  insert: (text: string) => void
  /** Swaps the trailing `/name` or `@path` token for a completion. */
  replaceToken: (token: string, value: string) => void
  /** True when the cursor is on the first (or last) line, so history can claim the key. */
  atEdge: (edge: "first" | "last") => boolean
  /** Cursor offset, read and written by vim mode. */
  cursor: () => number
  setCursor: (offset: number) => void
}

export function Editor({
  theme,
  keymap,
  motion,
  busy,
  focused = true,
  handle,
  onSubmit,
  onChange,
}: {
  theme: Theme
  keymap: Keymap
  motion: MotionLevel
  busy: boolean
  /** False while a modal is open, so its keystrokes do not also land in the buffer. */
  focused?: boolean
  handle: Ref<EditorHandle>
  onSubmit: (text: string) => void
  onChange: (text: string) => void
}) {
  const ref = useRef<TextareaRenderable>(null)
  const box = useRef<BoxRenderable>(null)

  useImperativeHandle(handle, () => ({
    text: () => ref.current?.plainText ?? "",
    clear: () => ref.current?.editBuffer.setText(""),
    set: (text: string) => ref.current?.editBuffer.setText(text),
    insert: (text: string) => ref.current?.editBuffer.insertText(text),
    replaceToken: (token: string, value: string) => {
      const current = ref.current
      if (!current) return
      const text = current.plainText
      current.editBuffer.setText(`${text.slice(0, text.length - token.length)}${value} `)
      current.cursorOffset = current.plainText.length
    },
    cursor: () => ref.current?.cursorOffset ?? 0,
    setCursor: (offset: number) => {
      const current = ref.current
      if (!current) return
      current.cursorOffset = Math.max(0, Math.min(offset, current.plainText.length))
    },
    atEdge: (edge: "first" | "last") => {
      const current = ref.current
      if (!current) return true
      const text = current.plainText
      const offset = current.cursorOffset
      return edge === "first" ? !text.slice(0, offset).includes("\n") : !text.slice(offset).includes("\n")
    },
  }))

  // While a turn runs the border breathes; the oscillator owns the color, so the static
  // prop below only has to be right for `reduced` and `off`.
  useOscillator(busy, BREATH_MS, motion, (t) => {
    if (box.current) box.current.borderColor = lerpHex(theme.border, theme.warning, t)
  })

  return (
    <box
      ref={box}
      style={{
        // A single rail on the left instead of a box: the prompt is the one thing that is
        // always there, and four sides of frame around it is four sides of noise. The busy
        // oscillator still owns this color, so the rail is what breathes during a turn.
        border: ["left"],
        borderColor: busy && motion !== "full" ? theme.warning : theme.border,
        backgroundColor: theme.panel,
        minHeight: 1,
        // One more than before, so the new padding does not cost two lines of visible prompt.
        maxHeight: 12,
        paddingLeft: 1,
        paddingRight: 1,
        // Breathing room above and below the text. The rail is drawn at the box edge, so it
        // runs the full height of the padding rather than stopping at the first line.
        paddingTop: 1,
        paddingBottom: 1,
        width: "100%",
      }}
    >
      <textarea
        ref={ref}
        focused={focused && !busy}
        placeholder={busy ? `working… ${describe(keymap.interrupt)} to stop` : "ask jarvis, or / for commands"}
        placeholderColor={theme.muted}
        textColor={theme.fg}
        backgroundColor={theme.panel}
        focusedBackgroundColor={theme.panel}
        cursorColor={theme.accent}
        wrapMode="word"
        keyBindings={[
          { ...keymap.submit, action: "submit" },
          { ...keymap.newline, action: "newline" },
          { name: "j", ctrl: true, action: "newline" },
        ]}
        onContentChange={() => onChange(ref.current?.plainText ?? "")}
        onSubmit={() => {
          const text = ref.current?.plainText ?? ""
          if (!text.trim()) return
          ref.current?.editBuffer.setText("")
          onSubmit(text)
        }}
        style={{ flexGrow: 1 }}
      />
    </box>
  )
}
