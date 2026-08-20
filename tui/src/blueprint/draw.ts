import type { Entity, Pt } from "./schema.ts"

/**
 * The drawing tool model: which tools exist, what key selects one, and what a drag with
 * it describes. Shared so the web toolbar and the terminal rail cannot drift apart — a
 * tool that means "rectangle" in one place has to mean it in the other, and `r` has to
 * pick it in both.
 *
 * Icons deliberately stay in the web toolbar: they are a `lucide` dependency and a
 * terminal has nowhere to put them.
 */
export type Tool =
  | "select"
  | "freehand"
  | "line"
  | "polyline"
  | "rect"
  | "circle"
  | "arc"
  | "text"
  | "dimension"
  | "symbol"

/**
 * `key` is the single-press shortcut; they are unique and lower case on purpose.
 * `pointer` marks a tool that needs a real pointing device — the terminal editor shows
 * those disabled rather than omitting them, so both toolbars read as the same set.
 */
export const TOOLS: { id: Tool; label: string; key: string; hint: string; pointer?: true }[] = [
  { id: "select", label: "Select", key: "v", hint: "Click, shift-click, or drag a box" },
  { id: "freehand", label: "Freehand", key: "f", hint: "Draw roughly — it snaps to a clean shape", pointer: true },
  { id: "line", label: "Line", key: "l", hint: "Drag from end to end" },
  { id: "polyline", label: "Polyline", key: "p", hint: "Click each corner, Enter to finish" },
  { id: "rect", label: "Rectangle", key: "r", hint: "Drag corner to corner" },
  { id: "circle", label: "Circle", key: "c", hint: "Drag from the centre" },
  { id: "arc", label: "Arc", key: "a", hint: "Drag centre to start, then click the end" },
  { id: "text", label: "Text", key: "t", hint: "Click, then type" },
  { id: "dimension", label: "Dimension", key: "d", hint: "Drag between the two points" },
  { id: "symbol", label: "Symbol", key: "s", hint: "Pick one from the panel, then click" },
]

/** The entity a drag from `from` to `to` describes, or null when it describes nothing. */
export function shapeFrom(tool: Tool, from: Pt, to: Pt, layer: string): Entity | null {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  switch (tool) {
    case "line":
      return dx === 0 && dy === 0 ? null : { type: "line", a: from, b: to, layer }
    case "rect": {
      const w = Math.abs(dx)
      const h = Math.abs(dy)
      if (w === 0 || h === 0) return null
      return { type: "rect", at: [Math.min(from[0], to[0]), Math.min(from[1], to[1])], w, h, layer }
    }
    case "circle": {
      const r = Math.hypot(dx, dy)
      return r > 0 ? { type: "circle", c: from, r, layer } : null
    }
    case "dimension": {
      const length = Math.hypot(dx, dy)
      if (length === 0) return null
      // A dimension with no offset sits on top of the thing it measures, which the checker
      // flags — so it starts a readable distance away and is adjustable from the panel.
      return { type: "dimension", a: from, b: to, offset: Math.max(length * 0.15, 2), layer }
    }
    default:
      return null
  }
}
