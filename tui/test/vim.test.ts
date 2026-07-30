import { describe, expect, test } from "bun:test"
import { initialVim, vimKey, type Key, type VimState } from "../src/ui/vim.ts"

/** Feeds a key sequence through the reducer and returns the resulting buffer and cursor. */
function run(text: string, cursor: number, keys: string, from: Partial<VimState> = {}) {
  let state: VimState = { ...initialVim, mode: "normal", ...from }
  let buffer = text
  let at = cursor
  for (const char of keys) {
    const key: Key = /[A-Z$]/.test(char) ? { name: char.toLowerCase(), shift: true } : { name: char }
    // `$` has no lowercase form; pass it through as its own name.
    const action = vimKey(state, char === "$" ? { name: "$" } : key, buffer, at)
    state = action.state
    if (action.text !== undefined) buffer = action.text
    if (action.cursor !== undefined) at = action.cursor
  }
  return { text: buffer, cursor: at, mode: state.mode, register: state.register }
}

describe("modes", () => {
  test("starts in insert so a fresh prompt is typeable, escape leaves it", () => {
    expect(initialVim.mode).toBe("insert")
    // Insert mode passes ordinary keys through to the textarea.
    expect(vimKey(initialVim, { name: "d" }, "", 0).handled).toBe(false)
    const escaped = vimKey(initialVim, { name: "escape" }, "abc", 3)
    expect(escaped.state.mode).toBe("normal")
    expect(escaped.cursor).toBe(2)
  })

  test("i a I A o O all enter insert at the right place", () => {
    expect(run("hello", 2, "i").mode).toBe("insert")
    expect(run("hello", 2, "a").cursor).toBe(3)
    expect(run("one\ntwo", 5, "I").cursor).toBe(4)
    expect(run("one\ntwo", 4, "A").cursor).toBe(7)
    expect(run("one\ntwo", 1, "o")).toMatchObject({ text: "one\n\ntwo", cursor: 4, mode: "insert" })
    expect(run("one\ntwo", 5, "O")).toMatchObject({ text: "one\n\ntwo", cursor: 4, mode: "insert" })
  })

  test("keys nobody mapped are left to the textarea", () => {
    expect(vimKey({ ...initialVim, mode: "normal" }, { name: "return" }, "hi", 2).handled).toBe(false)
    expect(vimKey({ ...initialVim, mode: "normal" }, { name: "up" }, "hi", 2).handled).toBe(false)
    // Ctrl chords stay available for the app's own bindings.
    expect(vimKey({ ...initialVim, mode: "normal" }, { name: "r", ctrl: true }, "hi", 2).handled).toBe(false)
  })
})

describe("motions", () => {
  test("h and l stay on the line", () => {
    expect(run("abc\ndef", 5, "h").cursor).toBe(4)
    expect(run("abc\ndef", 4, "h").cursor).toBe(4)
    expect(run("abc\ndef", 6, "l").cursor).toBe(7)
  })

  test("w b e walk words, treating punctuation as its own", () => {
    expect(run("foo bar baz", 0, "w").cursor).toBe(4)
    expect(run("foo bar baz", 4, "w").cursor).toBe(8)
    expect(run("foo bar", 4, "b").cursor).toBe(0)
    expect(run("foo bar", 0, "e").cursor).toBe(2)
    expect(run("foo.bar", 0, "w").cursor).toBe(3)
  })

  test("0 and $ hit the ends of the current line", () => {
    expect(run("hello world", 6, "0").cursor).toBe(0)
    expect(run("one\ntwo", 5, "0").cursor).toBe(4)
    expect(run("hello", 0, "$").cursor).toBe(4)
  })

  test("j and k keep the column and clamp to short lines", () => {
    expect(run("hello\nworld", 2, "j").cursor).toBe(8)
    expect(run("hello\nab", 4, "j").cursor).toBe(8)
    expect(run("hello\nworld", 8, "k").cursor).toBe(2)
    // Nothing above the first line or below the last.
    expect(run("only", 2, "k").cursor).toBe(2)
    expect(run("only", 2, "j").cursor).toBe(2)
  })

  test("gg and G jump to the ends of the buffer", () => {
    expect(run("a\nb\nc", 4, "gg").cursor).toBe(0)
    expect(run("a\nb\nc", 0, "G").cursor).toBe(4)
  })
})

describe("counts", () => {
  test("a count repeats a motion", () => {
    expect(run("one two three four", 0, "3w").cursor).toBe(14)
    expect(run("abcdef", 0, "3l").cursor).toBe(3)
  })

  test("a count repeats an operator", () => {
    expect(run("a\nb\nc\nd", 0, "2dd").text).toBe("c\nd")
  })

  test("0 is a motion on its own but a digit inside a count", () => {
    expect(run("hello world", 6, "0").cursor).toBe(0)
    // 10l would run off the end of "hello", so it clamps at the line end.
    expect(run("hello", 0, "10l").cursor).toBe(5)
  })
})

describe("changes", () => {
  test("x deletes forward and fills the register", () => {
    expect(run("hello", 0, "x").text).toBe("ello")
    expect(run("hello", 1, "3x")).toMatchObject({ text: "ho", register: "ell" })
  })

  test("dd deletes whole lines, D and C work to end of line", () => {
    expect(run("one\ntwo\nthree", 4, "dd").text).toBe("one\nthree")
    expect(run("hello world", 5, "D").text).toBe("hello")
    expect(run("hello world", 6, "C")).toMatchObject({ text: "hello ", mode: "insert" })
  })

  test("cc clears the line and leaves you typing on it", () => {
    expect(run("one\ntwo", 4, "cc")).toMatchObject({ text: "one\n", cursor: 4, mode: "insert" })
  })

  test("dw and cw take a word", () => {
    expect(run("foo bar baz", 4, "dw").text).toBe("foo baz")
    expect(run("foo bar", 0, "cw")).toMatchObject({ text: "bar", mode: "insert" })
  })

  test("yy then p duplicates a line below it", () => {
    let state: VimState = { ...initialVim, mode: "normal" }
    const text = "one\ntwo"
    const yank = vimKey(state, { name: "y" }, text, 0)
    state = vimKey(yank.state, { name: "y" }, text, 0).state
    expect(state.register).toBe("one\n")
    const pasted = vimKey(state, { name: "p" }, text, 0)
    expect(pasted.text).toBe("one\none\ntwo")
  })

  test("p with a character-wise register pastes after the cursor", () => {
    const state: VimState = { ...initialVim, mode: "normal", register: "XY" }
    expect(vimKey(state, { name: "p" }, "ab", 0).text).toBe("aXYb")
  })

  test("p with an empty register does nothing", () => {
    const state: VimState = { ...initialVim, mode: "normal", register: "" }
    expect(vimKey(state, { name: "p" }, "ab", 0).text).toBeUndefined()
  })

  test("changes are flagged for the undo stack, motions are not", () => {
    expect(vimKey({ ...initialVim, mode: "normal" }, { name: "x" }, "abc", 0).snapshot).toBe(true)
    expect(vimKey({ ...initialVim, mode: "normal" }, { name: "w" }, "a b", 0).snapshot).toBeUndefined()
  })
})

describe("pending state", () => {
  test("an unknown second key abandons the operator instead of half-applying it", () => {
    const first = vimKey({ ...initialVim, mode: "normal" }, { name: "d" }, "hello", 0)
    expect(first.state.pending).toBe("d")
    const second = vimKey(first.state, { name: "z" }, "hello", 0)
    expect(second.text).toBeUndefined()
    expect(second.state.pending).toBe("")
  })

  test("a completed command clears the pending buffer", () => {
    const counted = vimKey({ ...initialVim, mode: "normal" }, { name: "3" }, "a b c d", 0)
    expect(counted.state.pending).toBe("3")
    expect(vimKey(counted.state, { name: "w" }, "a b c d", 0).state.pending).toBe("")
  })
})
