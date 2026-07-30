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
}

export function Editor({
  theme,
  keymap,
  motion,
  busy,
  handle,
  onSubmit,
  onChange,
}: {
  theme: Theme
  keymap: Keymap
  motion: MotionLevel
  busy: boolean
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
        border: true,
        borderColor: busy && motion !== "full" ? theme.warning : theme.border,
        backgroundColor: theme.panel,
        minHeight: 3,
        maxHeight: 10,
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
      }}
    >
      <textarea
        ref={ref}
        focused={!busy}
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
