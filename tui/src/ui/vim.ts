/**
 * Modal editing for the prompt box. A pure reducer over (buffer, cursor, keypress) so the
 * whole thing is testable without a renderer; `useVim` only holds the mode, the pending
 * keystrokes, one register and an undo stack.
 *
 * Deliberately not implemented: named registers, marks, macros, visual mode, `:` commands,
 * and search. This is a prompt box, not an editor — add them when someone actually asks.
 */
import { useCallback, useRef, useState } from "react"
import type { EditorHandle } from "./components/editor.tsx"

export type VimMode = "normal" | "insert"

export type VimState = {
  mode: VimMode
  /** Digits and a half-typed operator, e.g. `"2d"` waiting for its second `d`. */
  pending: string
  /** The single unnamed register, filled by d/x/y and read by p. */
  register: string
}

/**
 * Insert to begin with, unlike vim proper. The whole purpose of this box is composing a
 * prompt, so landing in normal mode would mean every session starts by pressing `i`.
 */
export const initialVim: VimState = { mode: "insert", pending: "", register: "" }

export type Key = { name: string; shift?: boolean; ctrl?: boolean; meta?: boolean }

export type VimAction = {
  /** Set when the buffer changed. */
  text?: string
  cursor?: number
  state: VimState
  /** False means the key was not ours; the textarea should handle it normally. */
  handled: boolean
  /** Set when this action should become an undo point. */
  snapshot?: boolean
}

const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch)
const isSpace = (ch: string) => /\s/.test(ch)

const lineStart = (text: string, at: number) => text.lastIndexOf("\n", Math.max(0, at - 1)) + 1
const lineEnd = (text: string, at: number) => {
  const found = text.indexOf("\n", at)
  return found === -1 ? text.length : found
}

/** Start of the next word, vim's `w`. Punctuation counts as its own word. */
function wordForward(text: string, at: number): number {
  let i = at
  if (i >= text.length) return text.length
  const word = isWord(text[i]!)
  if (!isSpace(text[i]!)) {
    while (i < text.length && !isSpace(text[i]!) && isWord(text[i]!) === word) i++
  }
  while (i < text.length && isSpace(text[i]!)) i++
  return i
}

/** Start of the previous word, vim's `b`. */
function wordBack(text: string, at: number): number {
  let i = at - 1
  while (i > 0 && isSpace(text[i]!)) i--
  if (i <= 0) return 0
  const word = isWord(text[i]!)
  while (i > 0 && !isSpace(text[i - 1]!) && isWord(text[i - 1]!) === word) i--
  return Math.max(0, i)
}

/** Last character of the current or next word, vim's `e`. */
function wordEndOf(text: string, at: number): number {
  let i = at + 1
  while (i < text.length && isSpace(text[i]!)) i++
  if (i >= text.length) return text.length - 1
  const word = isWord(text[i]!)
  while (i + 1 < text.length && !isSpace(text[i + 1]!) && isWord(text[i + 1]!) === word) i++
  return i
}

/** Same column on the line `delta` away, clamped to that line's length. */
function verticalMove(text: string, at: number, delta: number): number {
  const start = lineStart(text, at)
  const column = at - start
  let target = start
  for (let step = 0; step < Math.abs(delta); step++) {
    target = delta < 0 ? lineStart(text, target - 1) : lineEnd(text, target) + 1
    if (delta > 0 && target > text.length) return at
    if (delta < 0 && target < 0) return at
  }
  if (delta < 0 && at === lineStart(text, 0)) return at
  return Math.min(target + column, lineEnd(text, target))
}

/**
 * Default result: pending cleared, key consumed. `patch` comes last so a case that needs a
 * different mode or register can say so — spreading it first would let these defaults
 * silently overwrite it.
 */
const done = (state: VimState, patch: Partial<VimAction> = {}): VimAction => ({
  state: { ...state, pending: "" },
  handled: true,
  ...patch,
})

/**
 * One keypress in normal mode. Returns `handled: false` for anything vim does not claim,
 * so unmapped keys keep working as themselves.
 */
export function vimKey(state: VimState, key: Key, text: string, cursor: number): VimAction {
  if (key.ctrl || key.meta) return { state, handled: false }

  if (state.mode === "insert") {
    if (key.name === "escape") {
      // Vim leaves the cursor on the last typed character, not past it.
      return done(state, { state: { ...state, mode: "normal", pending: "" }, cursor: Math.max(0, cursor - 1) })
    }
    return { state, handled: false }
  }

  const char = key.name.length === 1 ? (key.shift ? key.name.toUpperCase() : key.name) : key.name

  // Digits accumulate into a count, except a leading 0 which is the line-start motion.
  if (/^[1-9]$/.test(char) || (char === "0" && /\d$/.test(state.pending))) {
    return { state: { ...state, pending: state.pending + char }, handled: true }
  }

  const digits = /^\d+/.exec(state.pending)?.[0] ?? ""
  const count = digits ? Math.min(Number(digits), 1000) : 1
  const operator = state.pending.slice(digits.length)
  const command = operator + char

  // Waiting on the second key of a two-key command.
  if (!operator && "dcgy".includes(char)) return { state: { ...state, pending: state.pending + char }, handled: true }

  const repeat = <T>(fn: (at: number) => T, at: number): T => {
    let value = at as unknown as T
    for (let step = 0; step < count; step++) value = fn(value as unknown as number)
    return value
  }

  const start = lineStart(text, cursor)
  const end = lineEnd(text, cursor)

  switch (command) {
    // ── motions ────────────────────────────────────────────────────────────────────
    case "h":
      return done(state, { cursor: Math.max(start, cursor - count) })
    case "l":
      return done(state, { cursor: Math.min(end, cursor + count) })
    case "j":
      return done(state, { cursor: verticalMove(text, cursor, count) })
    case "k":
      return done(state, { cursor: verticalMove(text, cursor, -count) })
    case "w":
      return done(state, { cursor: repeat((at) => wordForward(text, at), cursor) })
    case "b":
      return done(state, { cursor: repeat((at) => wordBack(text, at), cursor) })
    case "e":
      return done(state, { cursor: repeat((at) => wordEndOf(text, at), cursor) })
    case "0":
      return done(state, { cursor: start })
    case "$":
      return done(state, { cursor: Math.max(start, end - 1) })
    case "gg":
      return done(state, { cursor: 0 })
    case "G":
      return done(state, { cursor: lineStart(text, text.length) })

    // ── entering insert ────────────────────────────────────────────────────────────
    case "i":
      return done(state, { state: { ...state, mode: "insert", pending: "" } })
    case "a":
      return done(state, { state: { ...state, mode: "insert", pending: "" }, cursor: Math.min(text.length, cursor + 1) })
    case "I":
      return done(state, { state: { ...state, mode: "insert", pending: "" }, cursor: start })
    case "A":
      return done(state, { state: { ...state, mode: "insert", pending: "" }, cursor: end })
    case "o":
      return done(state, {
        state: { ...state, mode: "insert", pending: "" },
        text: `${text.slice(0, end)}\n${text.slice(end)}`,
        cursor: end + 1,
        snapshot: true,
      })
    case "O":
      return done(state, {
        state: { ...state, mode: "insert", pending: "" },
        text: `${text.slice(0, start)}\n${text.slice(start)}`,
        cursor: start,
        snapshot: true,
      })

    // ── changes ────────────────────────────────────────────────────────────────────
    case "x": {
      const cut = text.slice(cursor, Math.min(end, cursor + count))
      if (!cut) return done(state)
      return done(state, {
        state: { ...state, pending: "", register: cut },
        text: text.slice(0, cursor) + text.slice(cursor + cut.length),
        cursor: Math.min(cursor, Math.max(start, lineEnd(text, cursor) - cut.length - 1)),
        snapshot: true,
      })
    }
    case "D":
      return done(state, {
        state: { ...state, pending: "", register: text.slice(cursor, end) },
        text: text.slice(0, cursor) + text.slice(end),
        cursor: Math.max(start, cursor - (cursor === start ? 0 : 1)),
        snapshot: true,
      })
    case "C":
      return done(state, {
        state: { ...state, mode: "insert", pending: "", register: text.slice(cursor, end) },
        text: text.slice(0, cursor) + text.slice(end),
        cursor,
        snapshot: true,
      })
    case "dd": {
      // `count` whole lines, including the newline that ends the last of them.
      let stop = start
      for (let step = 0; step < count; step++) stop = Math.min(text.length, lineEnd(text, stop) + 1)
      return done(state, {
        state: { ...state, pending: "", register: text.slice(start, stop) },
        text: text.slice(0, start) + text.slice(stop),
        cursor: start,
        snapshot: true,
      })
    }
    case "cc":
      return done(state, {
        state: { ...state, mode: "insert", pending: "", register: text.slice(start, end) },
        text: text.slice(0, start) + text.slice(end),
        cursor: start,
        snapshot: true,
      })
    case "dw": {
      const stop = repeat((at) => wordForward(text, at), cursor)
      return done(state, {
        state: { ...state, pending: "", register: text.slice(cursor, stop) },
        text: text.slice(0, cursor) + text.slice(stop),
        cursor,
        snapshot: true,
      })
    }
    case "cw": {
      const stop = repeat((at) => wordForward(text, at), cursor)
      return done(state, {
        state: { ...state, mode: "insert", pending: "", register: text.slice(cursor, stop) },
        text: text.slice(0, cursor) + text.slice(stop),
        cursor,
        snapshot: true,
      })
    }
    case "yy":
      return done(state, { state: { ...state, pending: "", register: text.slice(start, lineEnd(text, cursor) + 1) } })
    case "p": {
      if (!state.register) return done(state)
      // A line-wise register pastes below the current line, like vim.
      if (state.register.endsWith("\n")) {
        const at = Math.min(text.length, end + 1)
        return done(state, { text: text.slice(0, at) + state.register + text.slice(at), cursor: at, snapshot: true })
      }
      const at = Math.min(text.length, cursor + 1)
      return done(state, {
        text: text.slice(0, at) + state.register + text.slice(at),
        cursor: at + state.register.length - 1,
        snapshot: true,
      })
    }
    default:
      // Unknown command: drop whatever was pending rather than acting on half of it.
      return { state: { ...state, pending: "" }, handled: state.pending.length > 0 }
  }
}

/** How many buffer states `u` can walk back through. */
const UNDO_DEPTH = 50

/**
 * Drives the editor from `vimKey`. Returns the mode for the status line and a handler that
 * `app.tsx` consults before anything else, so normal-mode `d` deletes instead of typing.
 */
export function useVim(editor: { current: EditorHandle | null }, enabled: boolean) {
  const [mode, setMode] = useState<VimMode>(initialVim.mode)
  const state = useRef(initialVim)
  const undo = useRef<{ text: string; cursor: number }[]>([])

  const handle = useCallback(
    (key: Key): boolean => {
      if (!enabled) return false
      const current = editor.current
      if (!current) return false
      const text = current.text()
      const cursor = current.cursor()

      // `u` lives here rather than in the reducer: it walks the stack the hook owns.
      if (state.current.mode === "normal" && key.name === "u" && !key.shift && !key.ctrl) {
        const previous = undo.current.pop()
        if (previous) {
          current.set(previous.text)
          current.setCursor(previous.cursor)
        }
        return true
      }

      const action = vimKey(state.current, key, text, cursor)
      if (!action.handled) return false

      if (action.snapshot) {
        undo.current.push({ text, cursor })
        if (undo.current.length > UNDO_DEPTH) undo.current.shift()
      }
      if (action.text !== undefined) current.set(action.text)
      if (action.cursor !== undefined) current.setCursor(action.cursor)

      state.current = action.state
      if (action.state.mode !== mode) setMode(action.state.mode)
      return true
    },
    [editor, enabled, mode],
  )

  /** A submitted prompt is gone; the next one starts fresh, ready to type. */
  const reset = useCallback(() => {
    state.current = { ...state.current, mode: "insert", pending: "" }
    undo.current = []
    setMode("insert")
  }, [])

  return { mode: enabled ? mode : undefined, handle, reset }
}
