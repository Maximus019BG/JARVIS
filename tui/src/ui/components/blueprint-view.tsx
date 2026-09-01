import { useMemo } from "react"
import { renderCells, type Cell, type Viewport } from "../../blueprint/render-braille.ts"
import { BlueprintError, type BlueprintDoc } from "../../blueprint/schema.ts"
import { readDoc } from "../../blueprint/store.ts"
import type { Theme } from "../../config/theme.ts"

/**
 * Drawing a blueprint into a terminal, shared by the side pane and the fullscreen editor.
 *
 * Both want the same three things — read the file, turn it into cells, colour each cell by
 * the layer that drew it — and the third is the only one with any judgement in it: a
 * `layer.color` is a hex string from the document, so the picture is coloured the way the
 * drawing says it should be, not by a palette this file invents.
 */

/** A read attempt. A broken file is a state to display, not an exception to swallow. */
export type Loaded = { doc: BlueprintDoc } | { error: string }

export function useDoc(root: string, name: string | undefined, revision: unknown): Loaded | undefined {
  return useMemo(() => {
    if (!name) return undefined
    try {
      return { doc: readDoc(root, name) }
    } catch (error) {
      // Shown rather than thrown: a parse error in the pane is how the user finds out the
      // file is broken, and a blank box would tell them nothing.
      return { error: error instanceof BlueprintError ? error.message : String(error) }
    }
    // `revision` is the cache key: whatever the caller changes when the file may have.
  }, [root, name, revision])
}

/** Layer id → colour, falling back to the theme so an unstyled layer is still visible. */
export function palette(doc: BlueprintDoc, theme: Theme): Map<string | undefined, string> {
  const map = new Map<string | undefined, string>([[undefined, theme.dim]])
  for (const layer of doc.layers) map.set(layer.id, layer.color ?? theme.fg)
  return map
}

export type PictureProps = {
  doc: BlueprintDoc
  theme: Theme
  cols: number
  rows: number
  view?: Viewport
  grid?: number
  scaleBar?: boolean
  /** Drawn over the picture after the fact: the editor's cursor, its selection marks. */
  overlay?: (cells: Cell[][]) => Cell[][]
}

/**
 * A grid of cells as rows of text, split into runs of a single colour.
 *
 * Runs rather than one span per cell because a 90-column drawing is 90 spans a row and
 * 30 rows of that is a redraw the terminal notices — and consecutive cells almost always
 * share a layer, so the runs are long.
 *
 * Takes cells rather than a document so the editor, which needs the projection anyway to
 * place its cursor, can render what it already has instead of drawing it twice.
 */
export function Cells({
  cells,
  colours,
  fallback,
}: {
  cells: Cell[][]
  colours: Map<string | undefined, string>
  fallback: string
}) {
  return (
    <>
      {cells.map((row, index) => {
        const runs: { text: string; fg: string }[] = []
        for (const cell of row) {
          const fg = colours.get(cell.layer) ?? fallback
          const last = runs.at(-1)
          if (last && last.fg === fg) last.text += cell.ch
          else runs.push({ text: cell.ch, fg })
        }
        return (
          <text key={index}>
            {runs.map((run, n) => (
              <span key={n} fg={run.fg}>
                {run.text}
              </span>
            ))}
          </text>
        )
      })}
    </>
  )
}

/** `renderCells` and `Cells` together, for a caller that only wants to look at a drawing. */
export function Picture({ doc, theme, cols, rows, view, grid, scaleBar, overlay }: PictureProps) {
  const { cells } = renderCells(doc, { cols, rows, view, grid, scaleBar })
  return <Cells cells={overlay ? overlay(cells) : cells} colours={palette(doc, theme)} fallback={theme.fg} />
}

/**
 * The side pane: whatever blueprint the agent is working on, live, next to the transcript.
 *
 * Deliberately read-only and deliberately not scrollable. It exists so that a turn spent
 * drawing is not a wall of tool calls describing a picture nobody can see — the moment it
 * grows controls it is competing with the editor for the same keyboard.
 */
export function BlueprintPane({
  root,
  name,
  revision,
  theme,
  width,
  height,
}: {
  root: string
  name: string
  revision: unknown
  theme: Theme
  width: number
  height: number
}) {
  const loaded = useDoc(root, name, revision)
  // Two for the border, two for the padding; two rows for the border and one for the footer.
  const cols = Math.max(10, width - 4)
  const rows = Math.max(4, height - 4)

  return (
    <box
      title={name}
      titleColor={theme.accent}
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: theme.border,
        backgroundColor: theme.bg,
        flexDirection: "column",
        width,
        height,
        paddingLeft: 1,
        paddingRight: 1,
        flexShrink: 0,
      }}
    >
      {loaded === undefined ? null : "error" in loaded ? (
        <text fg={theme.error}>{loaded.error}</text>
      ) : (
        <>
          <Picture doc={loaded.doc} theme={theme} cols={cols} rows={rows} scaleBar />
          <text fg={theme.dim}>
            {`${loaded.doc.entities.length} entities${loaded.doc.parts.length > 0 ? ` · ${loaded.doc.parts.length} parts` : ""}`}
          </text>
        </>
      )}
    </box>
  )
}
