import { bbox, flatten } from "./geom.ts"
import type { BlueprintDoc, Entity, Pt } from "./schema.ts"

/**
 * Braille cells pack a 2×4 dot grid into one character, so an 80×24 terminal becomes a
 * 160×96 bitmap. That is enough to read a bracket outline, and it needs no graphics
 * protocol, no image support and no dependency — it works over ssh to a Pi.
 *
 * Dot bit layout inside U+2800:  1 4      0x01 0x08
 *                                2 5      0x02 0x10
 *                                3 6      0x04 0x20
 *                                7 8      0x40 0x80
 */
const DOT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

export type Viewport = [number, number, number, number]

export type BrailleOptions = {
  cols: number
  rows: number
  /** [minX, minY, width, height]; defaults to the drawing's own bounds, else the sheet. */
  view?: Viewport
  /** Layer ids to draw. Omitted means every visible layer. */
  layers?: string[]
  /** Draw the sheet border and a light margin cross. Off by default. */
  frame?: boolean
}

/** Fits `view` into the dot grid without distorting it, and centres the leftover. */
function projector(view: Viewport, width: number, height: number) {
  const [vx, vy, vw, vh] = view
  const k = Math.min(width / (vw || 1), height / (vh || 1))
  const ox = (width - vw * k) / 2
  const oy = (height - vh * k) / 2
  return ([x, y]: Pt): Pt => [ox + (x - vx) * k, oy + (y - vy) * k]
}

/** Bresenham, so a diagonal never leaves gaps the way naive interpolation does. */
function line(set: (x: number, y: number) => void, a: Pt, b: Pt) {
  let x0 = Math.round(a[0])
  let y0 = Math.round(a[1])
  const x1 = Math.round(b[0])
  const y1 = Math.round(b[1])
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let error = dx + dy
  for (;;) {
    set(x0, y0)
    if (x0 === x1 && y0 === y1) return
    const doubled = 2 * error
    if (doubled >= dy) {
      error += dy
      x0 += sx
    }
    if (doubled <= dx) {
      error += dx
      y0 += sy
    }
  }
}

const visibleLayers = (doc: BlueprintDoc, only?: string[]): Set<string> =>
  new Set(
    doc.layers
      .filter((layer) => (only ? only.includes(layer.id) : layer.visible !== false))
      .map((layer) => layer.id),
  )

function drawn(doc: BlueprintDoc, only?: string[]): Entity[] {
  const layers = visibleLayers(doc, only)
  return doc.entities.filter((entity) => layers.has(entity.layer ?? doc.layers[0]!.id))
}

/**
 * The drawing's own bounds with a 4% margin, falling back to the sheet when the drawing
 * is empty. Fitting content rather than the sheet is what makes a two-line sketch
 * legible instead of a speck in the corner of an A4 page.
 */
export function autoView(doc: BlueprintDoc, only?: string[]): Viewport {
  const box = bbox(drawn(doc, only))
  if (!box) return doc.viewBox
  const [minX, minY, maxX, maxY] = box
  const w = maxX - minX
  const h = maxY - minY
  const pad = Math.max(w, h, 1) * 0.04
  return [minX - pad, minY - pad, w + pad * 2, h + pad * 2]
}

export function renderBraille(doc: BlueprintDoc, options: BrailleOptions): string[] {
  const cols = Math.max(1, Math.floor(options.cols))
  const rows = Math.max(1, Math.floor(options.rows))
  const width = cols * 2
  const height = rows * 4
  const cells = new Uint8Array(cols * rows)

  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    cells[(y >> 2) * cols + (x >> 1)]! |= DOT[x & 1]![y & 3]!
  }

  const project = projector(options.view ?? autoView(doc, options.layers), width, height)
  const entities = drawn(doc, options.layers)

  if (options.frame) {
    const [vx, vy, vw, vh] = doc.viewBox
    const corners: Pt[] = [
      [vx, vy],
      [vx + vw, vy],
      [vx + vw, vy + vh],
      [vx, vy + vh],
      [vx, vy],
    ]
    for (let i = 0; i < corners.length - 1; i++) line(set, project(corners[i]!), project(corners[i + 1]!))
  }

  for (const entity of entities) {
    for (const run of flatten(entity)) {
      for (let i = 0; i < run.length - 1; i++) line(set, project(run[i]!), project(run[i + 1]!))
    }
  }

  const out: string[] = []
  for (let row = 0; row < rows; row++) {
    let text = ""
    for (let col = 0; col < cols; col++) text += String.fromCharCode(0x2800 + cells[row * cols + col]!)
    // Trailing blank cells are still U+2800, not spaces, and they make every line the
    // full width in a copy-paste. Trim them; leading ones must stay for alignment.
    out.push(text.replace(/⠀+$/, ""))
  }

  // Text entities cannot be drawn as dots at this resolution, so they are listed under
  // the picture instead of silently vanishing.
  const labels = entities.filter((entity) => entity.type === "text")
  if (labels.length > 0) {
    out.push("")
    for (const label of labels) {
      if (label.type === "text") out.push(`  "${label.text}" at ${label.at[0]}, ${label.at[1]}`)
    }
  }
  return out
}
