import type { BoxRenderable, TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useImperativeHandle, useRef, type Ref } from "react"
import type { Keymap } from "../../config/keybinds.ts"
import { describe } from "../../config/keybinds.ts"
import type { Theme } from "../../config/theme.ts"
import { lerpHex, useOscillator, type MotionLevel } from "../motion.ts"

/** One breath of the busy border, slow enough to read as waiting rather than blinking. */
const BREATH_MS = 1400

/**
 * Below this the mic button drops its label and keeps only the icon. Ten columns of key
 * hint is a fair trade at 80, and a tenth of the prompt in a narrow tmux pane.
 */
const VOICE_LABEL_AT = 60

/**
 * The mic button's icon: the real MICROPHONE codepoint, followed by U+FE0E VARIATION
 * SELECTOR-15 asking for the monochrome text glyph rather than the colour emoji — every
 * codepoint Unicode names "microphone" is an emoji, so this is the only way to name one
 * while asking to look like the geometry the rest of the app is drawn in (`⑂ ▸ ▾ ● ✓`).
 *
 * Escapes rather than a literal on purpose. The selector is invisible, so a paste that drops
 * or doubles it changes how this renders with nothing in the diff to show it — and the
 * doubled form is exactly the case that breaks. Measured through the opentui harness:
 *
 *   U+1F3A4                  aligned (two cells, measured correctly)
 *   U+1F3A4 U+FE0E           aligned            <- this one
 *   U+1F3A4 U+FE0E U+FE0E    one cell too wide, the second selector counted as its own cell
 *   U+1F399 U+FE0E           one cell too wide  <- the tempting studio-mic alternative
 *
 * VS15 is a request, not a guarantee: a terminal may ignore it for a character with
 * Emoji_Presentation=Yes and draw the colour glyph anyway. What it reliably buys is the
 * correct character and correct width. If the colour emoji is unwanted, `⏺` (U+23FA, named
 * BLACK CIRCLE FOR RECORD) is the fallback — geometric and neutral-width, but a record dot.
 */
export const MIC = "\u{1F3A4}\u{FE0E}"

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
  recording = false,
  onVoice,
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
  /** Whether the mic is live, so the button can say so rather than just offering. */
  recording?: boolean
  /**
   * Starts or stops push-to-talk. Absent when `voice` is not configured, which is also what
   * hides the button: advertising a key that can only answer "voice is off" is worse than
   * not mentioning it.
   */
  onVoice?: () => void
}) {
  const ref = useRef<TextareaRenderable>(null)
  const box = useRef<BoxRenderable>(null)
  const { width } = useTerminalDimensions()

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
        border: ["bottom"],
        borderColor: busy && motion !== "full" ? theme.warning : theme.border,
        backgroundColor: theme.panel,
        minHeight: 1,
        // Two more than the text cap, so the vertical padding does not eat visible prompt lines.
        maxHeight: 12,
        paddingLeft: 1,
        paddingRight: 1,
        // Breathing room above and below the text. The rail is drawn at the box edge, so it
        // runs the full height of the padding rather than stopping at the first line.
        paddingTop: 1,
        paddingBottom: 1,
        width: "100%",
        // The prompt and the mic button sit side by side; the button is the only thing to
        // the right of the text, so a row is the whole layout.
        flexDirection: "row",
      }}
    >
      <textarea
        ref={ref}
        // Not `focused && !busy`: locking the prompt for the length of a turn is the single
        // thing that makes a TUI feel slow. What you type while it runs is queued, not lost.
        focused={focused}
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
      {onVoice && (
        // Top-aligned rather than centred: the prompt grows downwards as you type, and a
        // button that slides down the rail with it reads as if it moved on its own.
        <box
          onMouseDown={onVoice}
          style={{ flexShrink: 0, alignSelf: "flex-start", paddingLeft: 1 }}
        >
          {/* The icon never changes shape, only colour: it is how the eye finds the button
              again, and a control that becomes a different symbol has moved as far as the
              reader is concerned. The label beside it carries the state. */}
          <text fg={recording ? theme.warning : theme.dim}>
            {width >= VOICE_LABEL_AT ? `${MIC} ${recording ? "recording" : describe(keymap.voice)}` : MIC}
          </text>
        </box>
      )}
    </box>
  )
}
