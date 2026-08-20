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
  /** Faint dots every `grid` document units, for judging size and alignment. */
  grid?: number
  /** A bottom row reading `├─── 50 mm ───┤`, so the picture has a scale. */
  scaleBar?: boolean
  /** Write each `text` entity into the picture where it sits, not only underneath it. */
  labels?: boolean
}

/**
 * One character of the picture and the layer that put it there.
 *
 * The layer is what lets a front-end colour the drawing the way the drawing says it should
 * be coloured — a wire on `power` red, an outline black — instead of one flat colour for
 * everything. Last writer wins, which matches what the eye sees: whatever was drawn on top.
 */
export type Cell = { ch: string; layer?: string }

export type Rendered = {
  cells: Cell[][]
  /** Which cell a document point falls in. Fractional cells are floored, like the dots. */
  toCell(p: Pt): [col: number, row: number]
  /** The document point at a cell's top-left corner — the inverse, for a cursor. */
  toDoc(col: number, row: number): Pt
  /** Labels that would not fit in the grid, so a caller can list them underneath. */
  overflow: { text: string; at: Pt }[]
  view: Viewport
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

/**
 * The picture as a grid of characters, each remembering which layer drew it.
 *
 * `renderBraille` below is this, flattened. The split exists because a terminal pane wants
 * to colour per layer and to move a cursor in document coordinates, and both of those need
 * the projection and the layer map that the flat string throws away.
 */
export function renderCells(doc: BlueprintDoc, options: BrailleOptions): Rendered {
  const cols = Math.max(1, Math.floor(options.cols))
  const rows = Math.max(1, Math.floor(options.rows))
  const width = cols * 2
  const height = rows * 4
  const dots = new Uint8Array(cols * rows)
  /** Layer per cell, parallel to `dots`. */
  const owner = new Array<string | undefined>(cols * rows)

  let layer: string | undefined
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = (y >> 2) * cols + (x >> 1)
    dots[index]! |= DOT[x & 1]![y & 3]!
    owner[index] = layer
  }

  const view = options.view ?? autoView(doc, options.layers)
  const project = projector(view, width, height)
  const entities = drawn(doc, options.layers)

  // Grid first, so anything real drawn on top of a grid dot claims the cell.
  //
  // Only when the dots would land far enough apart to read as a grid. A cell is 2 dots wide
  // and 4 tall, so a step that looks generous horizontally is half as generous vertically —
  // below about eight cells the result is a field of speckle over the drawing, which is
  // worse than no grid at all. Skipped rather than drawn badly.
  const gridCells = options.grid ? (options.grid / (view[2] || 1)) * cols : 0
  if (options.grid && options.grid > 0 && gridCells >= 8) {
    layer = undefined
    const [vx, vy, vw, vh] = view
    const step = options.grid
    for (let x = Math.ceil(vx / step) * step; x <= vx + vw; x += step) {
      for (let y = Math.ceil(vy / step) * step; y <= vy + vh; y += step) {
        const [px, py] = project([x, y])
        set(Math.round(px), Math.round(py))
      }
    }
  }

  if (options.frame) {
    layer = undefined
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

  const fallback = doc.layers[0]!.id
  for (const entity of entities) {
    layer = entity.layer ?? fallback
    for (const run of flatten(entity)) {
      for (let i = 0; i < run.length - 1; i++) line(set, project(run[i]!), project(run[i + 1]!))
    }
  }

  const cells: Cell[][] = []
  for (let row = 0; row < rows; row++) {
    const line: Cell[] = []
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col
      line.push({ ch: String.fromCharCode(0x2800 + dots[index]!), layer: owner[index] })
    }
    cells.push(line)
  }

  const toCell = (p: Pt): [number, number] => {
    const [px, py] = project(p)
    return [Math.floor(px / 2), Math.floor(py / 4)]
  }
  // Reverses `projector`: the same fit, undone. Held here rather than exported from
  // `projector` so the two cannot disagree about the centring offsets.
  const [vx, vy, vw, vh] = view
  const k = Math.min(width / (vw || 1), height / (vh || 1))
  const ox = (width - vw * k) / 2
  const oy = (height - vh * k) / 2
  const toDoc = (col: number, row: number): Pt => [vx + (col * 2 - ox) / k, vy + (row * 4 - oy) / k]

  // Labels are written into the grid last: at 2×4 dots per cell a glyph cannot be drawn as
  // dots, and a name on the part beats a name in a list below the picture.
  const overflow: { text: string; at: Pt }[] = []
  /** Cell indices already holding a glyph, so two labels cannot become one unreadable one. */
  const written = new Set<number>()
  for (const entity of entities) {
    if (entity.type !== "text") continue
    const [col, row] = toCell(entity.at)
    const text = entity.text.slice(0, cols)
    // Centred on the anchor, the way the SVG renderer draws it.
    const start = Math.max(0, Math.min(cols - text.length, col - Math.floor(text.length / 2)))
    const target = cells[row]
    // One cell of padding either side, or two neighbours render as `GPIO4ESP32GPIO25` —
    // technically both present, actually unreadable.
    const fits =
      options.labels !== false &&
      target !== undefined &&
      row >= 0 &&
      [...text].every((_, i) => target[start + i] !== undefined) &&
      !written.has(row * cols + start - 1) &&
      !written.has(row * cols + start + text.length) &&
      [...text].every((_, i) => !written.has(row * cols + start + i))
    // Dropped rather than made unreadable — and still reported, so nothing disappears
    // without being said.
    if (!fits || !target) {
      overflow.push({ text: entity.text, at: entity.at })
      continue
    }
    for (let i = 0; i < text.length; i += 1) {
      target[start + i] = { ch: text[i]!, layer: entity.layer ?? fallback }
      written.add(row * cols + start + i)
    }
  }

  if (options.scaleBar) {
    const bar = scaleBar(cols, view, doc.units)
    if (bar) cells.push([...bar].map((ch) => ({ ch })))
  }

  return { cells, toCell, toDoc, overflow, view }
}

/**
 * `├─── 50 mm ───┤` at a round number of units, sized to fit in a third of the width.
 * A picture scaled to fit its content has no scale unless something says so.
 */
function scaleBar(cols: number, view: Viewport, units: string): string | undefined {
  const perCell = view[2] / (cols || 1)
  const target = perCell * Math.max(6, Math.floor(cols / 3))
  const magnitude = 10 ** Math.floor(Math.log10(target || 1))
  const span = [1, 2, 5].map((factor) => magnitude * factor).find((value) => value >= target) ?? magnitude * 10
  const inner = Math.round(span / perCell) - 2
  if (inner < 3 || inner + 2 > cols) return undefined
  const text = ` ${span >= 1 ? span : Number(span.toFixed(2))} ${units} `
  const dashes = Math.max(1, Math.floor((inner - text.length) / 2))
  if (dashes * 2 + text.length > inner) return undefined
  return `\u251c${"\u2500".repeat(dashes)}${text}${"\u2500".repeat(inner - dashes - text.length)}\u2524`
}

export function renderBraille(doc: BlueprintDoc, options: BrailleOptions): string[] {
  // Labels are written in place by default here too: the model reads this preview to check
  // its own work, and "R1" sitting on the resistor is the difference between checking the
  // drawing and checking a list of coordinates.
  const { cells, overflow } = renderCells(doc, options)
  const out = cells.map((row) =>
    // Trailing blank cells are still U+2800, not spaces, and they make every line the
    // full width in a copy-paste. Trim them; leading ones must stay for alignment.
    row
      .map((cell) => cell.ch)
      .join("")
      .replace(/\u2800+$/, ""),
  )

  // Text entities cannot be drawn as dots at this resolution, so any that were not written
  // into the picture are listed under it instead of silently vanishing.
  if (overflow.length > 0) {
    out.push("")
    for (const label of overflow) out.push(`  "${label.text}" at ${label.at[0]}, ${label.at[1]}`)
  }
  return out
}
