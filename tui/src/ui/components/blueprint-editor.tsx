import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useMemo, useState } from "react"
import { checkDoc, type CheckDomain } from "../../blueprint/check.ts"
import { shapeFrom, TOOLS, type Tool } from "../../blueprint/draw.ts"
import { applyOps, type Op } from "../../blueprint/ops.ts"
import { entitiesWithin, hitTest } from "../../blueprint/pick.ts"
import { bbox } from "../../blueprint/geom.ts"
import { autoView, renderCells, type Cell, type Viewport } from "../../blueprint/render-braille.ts"
import { BlueprintError, type BlueprintDoc, type Pt } from "../../blueprint/schema.ts"
import { searchSymbols, GRID } from "../../blueprint/symbols/index.ts"
import { writeDoc } from "../../blueprint/store.ts"
import type { Theme } from "../../config/theme.ts"
import { Cells, palette, useDoc } from "./blueprint-view.tsx"
import { Modal } from "./dialog.tsx"

/**
 * The blueprint editor, fullscreen, in the terminal.
 *
 * Same tools, same keys, same operations and the same file as the web editor: `TOOLS` and
 * `shapeFrom` come from `draw.ts`, selection from `pick.ts`, symbol placement from the
 * `place` op, and undo is a slice of a journal replayed with `applyOps` — which is exactly
 * what `useEditorDoc` does in the browser. Nothing here is a second drawing engine; a rect
 * drawn in this box and a rect drawn in Chrome are the same three lines of JSON.
 *
 * ponytail: the journal is local state rather than a shared `session.ts` module. It is six
 * lines and the web hook already has its own copy; extract it when there is a third caller.
 */

/** What the keyboard is doing right now. Only one of these can be true at a time. */
type Mode =
  | { kind: "draw" }
  /** Mid-drag: the first corner is down, the cursor is choosing the second. */
  | { kind: "drag"; from: Pt }
  | { kind: "symbols"; query: string; index: number }
  | { kind: "text"; at: Pt; typed: string }
  /** Wiring two ports. `from` is set once the first is chosen. */
  | { kind: "connect"; from?: string }

const RAIL = 16
const SIDE = 30

/** Cursor step. The schematic grid, so a port always lands exactly on the cursor. */
const STEP = GRID

const zoom = (view: Viewport, factor: number): Viewport => {
  const [x, y, w, h] = view
  return [x + (w - w * factor) / 2, y + (h - h * factor) / 2, w * factor, h * factor]
}

const pan = (view: Viewport, by: Pt): Viewport => [view[0] + by[0], view[1] + by[1], view[2], view[3]]

/** Nearest port to a point, as the `"REF.PORT"` address `connect` takes. */
function nearestPort(doc: BlueprintDoc, to: Pt): { address: string; at: Pt } | undefined {
  let best: { address: string; at: Pt; distance: number } | undefined
  for (const part of doc.parts) {
    part.ports.forEach((port, index) => {
      const distance = Math.hypot(port[0] - to[0], port[1] - to[1])
      if (!best || distance < best.distance) {
        best = { address: `${part.ref}.${index + 1}`, at: port, distance }
      }
    })
  }
  return best && { address: best.address, at: best.at }
}

export function BlueprintEditor({
  root,
  name,
  theme,
  domain = "general",
  onClose,
}: {
  root: string
  name: string
  theme: Theme
  domain?: CheckDomain
  onClose: () => void
}) {
  const { width, height } = useTerminalDimensions()
  /** Bumped after a save, so the base document is re-read from disk. */
  const [revision, setRevision] = useState(0)
  const loaded = useDoc(root, name, revision)
  const base = loaded && "doc" in loaded ? loaded.doc : undefined

  const [journal, setJournal] = useState<Op[]>([])
  const [redoable, setRedoable] = useState<Op[]>([])
  const [tool, setTool] = useState<Tool>("select")
  const [mode, setMode] = useState<Mode>({ kind: "draw" })
  /** Null until the reader moves it: it starts in the middle of whatever is drawn. */
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [layer, setLayer] = useState(0)
  /** Undefined means "fit the drawing"; set once the user zooms or pans. */
  const [view, setView] = useState<Viewport | undefined>(undefined)
  const [status, setStatus] = useState<string>("")

  // Every op was validated against this exact prefix when it was pushed, so the replay
  // cannot fail — but a throw here would blank the drawing, so it falls back to the base.
  const doc = useMemo(() => {
    if (!base) return undefined
    if (journal.length === 0) return base
    try {
      return applyOps(base, journal).doc
    } catch {
      return base
    }
  }, [base, journal])

  /**
   * Where the cursor is. Starting it at the origin looked right and was not: the view fits
   * what is drawn, and on a schematic drawn away from the origin that puts the cursor off
   * screen before the first keypress.
   */
  const at = useMemo((): Pt => {
    if (cursor) return cursor
    const box = doc ? bbox(doc.entities) : undefined
    if (!box) return [0, 0]
    const snap = (value: number) => Math.round(value / STEP) * STEP
    return [snap((box[0] + box[2]) / 2), snap((box[1] + box[3]) / 2)]
  }, [cursor, doc])

  const cols = Math.max(10, width - RAIL - SIDE - 4)
  const rows = Math.max(6, height - 6)
  // Until the reader zooms or pans, the view fits the drawing *and* the cursor — a cursor
  // that has walked off the sheet is a cursor nobody can aim.
  const fitted = useMemo((): Viewport | undefined => {
    if (!doc) return undefined
    const [vx, vy, vw, vh] = autoView(doc)
    const x0 = Math.min(vx, at[0])
    const y0 = Math.min(vy, at[1])
    return [x0, y0, Math.max(vx + vw, at[0]) - x0, Math.max(vy + vh, at[1]) - y0]
  }, [doc, at])
  const rendered = useMemo(
    () => (doc ? renderCells(doc, { cols, rows, view: view ?? fitted, grid: STEP * 4, scaleBar: true }) : undefined),
    [doc, cols, rows, view, fitted],
  )

  /** Applies ops optimistically, refusing the batch rather than storing something invalid. */
  const push = (...ops: Op[]) => {
    if (!doc || ops.length === 0) return false
    try {
      const result = applyOps(doc, ops)
      setStatus(result.warnings[0] ?? result.summary)
    } catch (error) {
      setStatus(error instanceof BlueprintError ? error.message : String(error))
      return false
    }
    setJournal((current) => [...current, ...ops])
    setRedoable([])
    return true
  }

  const layerId = doc?.layers[Math.min(layer, (doc.layers.length ?? 1) - 1)]?.id ?? "l0"

  useKeyboard((key) => {
    if (!doc || !rendered) return
    const stop = () => key.stopPropagation()

    // A mode that is reading text owns the keyboard entirely, or `l` types a letter and
    // switches to the line tool at the same time.
    if (mode.kind === "symbols") {
      const matches = searchSymbols({ query: mode.query })
      if (key.name === "escape") setMode({ kind: "draw" })
      else if (key.name === "up") setMode({ ...mode, index: Math.max(0, mode.index - 1) })
      else if (key.name === "down") setMode({ ...mode, index: Math.min(matches.length - 1, mode.index + 1) })
      else if (key.name === "backspace") setMode({ ...mode, query: mode.query.slice(0, -1), index: 0 })
      else if (key.name === "return") {
        const chosen = matches[mode.index]
        if (chosen) {
          push({ op: "place", symbol: chosen.name, at, layer: layerId })
          setMode({ kind: "draw" })
        }
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
        setMode({ ...mode, query: mode.query + key.sequence, index: 0 })
      }
      return stop()
    }

    if (mode.kind === "text") {
      if (key.name === "escape") setMode({ kind: "draw" })
      else if (key.name === "backspace") setMode({ ...mode, typed: mode.typed.slice(0, -1) })
      else if (key.name === "return") {
        if (mode.typed) push({ op: "add", entity: { type: "text", at: mode.at, text: mode.typed, layer: layerId } })
        setMode({ kind: "draw" })
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
        setMode({ ...mode, typed: mode.typed + key.sequence })
      }
      return stop()
    }

    // `q` as well as escape, like `Panel`: a bare ESC is ambiguous — it is also the first
    // byte of every arrow key — so a terminal that waits to disambiguate makes escape feel
    // sticky, and there should always be a way out that does not.
    if (key.name === "escape" || (key.name === "q" && !key.ctrl)) {
      if (mode.kind !== "draw") setMode({ kind: "draw" })
      else if (selection.length > 0) setSelection([])
      else onClose()
      return stop()
    }

    // Cursor, or pan when there is nothing to point at.
    const far = key.shift ? 10 : 1
    const arrow: Record<string, Pt> = {
      left: [-STEP * far, 0],
      right: [STEP * far, 0],
      up: [0, -STEP * far],
      down: [0, STEP * far],
    }
    const move = arrow[key.name ?? ""]
    if (move) {
      if (key.ctrl) setView(pan(view ?? rendered.view, move))
      else setCursor([at[0] + move[0], at[1] + move[1]])
      return stop()
    }

    if (key.name === "return") {
      if (mode.kind === "connect") {
        const port = nearestPort(doc, at)
        if (!port) setStatus("nothing placed yet — press s to drop a symbol first")
        else if (!mode.from) {
          setCursor(port.at)
          setMode({ kind: "connect", from: port.address })
          setStatus(`from ${port.address} — move to the other port and press enter`)
        } else {
          push({ op: "connect", from: mode.from, to: port.address, layer: layerId })
          setMode({ kind: "draw" })
        }
        return stop()
      }
      if (tool === "select") {
        if (mode.kind === "drag") {
          setSelection(entitiesWithin(doc, mode.from, at))
          setMode({ kind: "draw" })
        } else {
          const hit = hitTest(doc, at, STEP)
          if (hit) setSelection(key.shift ? [...new Set([...selection, hit])] : [hit])
          else setMode({ kind: "drag", from: at })
        }
        return stop()
      }
      if (tool === "text") {
        setMode({ kind: "text", at, typed: "" })
        return stop()
      }
      if (tool === "polyline" || tool === "arc") {
        // Both need a third point the two-point model has nowhere to put. Said out loud
        // rather than silently doing something else.
        setStatus(`${tool} needs the web editor — it takes three points`)
        return stop()
      }
      if (mode.kind === "drag") {
        const entity = shapeFrom(tool, mode.from, at, layerId)
        if (entity) push({ op: "add", entity })
        else setStatus("that shape has no size")
        setMode({ kind: "draw" })
      } else {
        setMode({ kind: "drag", from: at })
      }
      return stop()
    }

    const picked = TOOLS.find((entry) => entry.key === key.name && !key.ctrl && !key.shift)
    if (picked) {
      if (picked.pointer) setStatus(`${picked.label} needs a pointer — use the web editor`)
      else if (picked.id === "symbol") setMode({ kind: "symbols", query: "", index: 0 })
      else {
        setTool(picked.id)
        setMode({ kind: "draw" })
        setStatus(picked.hint)
      }
      return stop()
    }

    if (key.name === "u" && !key.ctrl) {
      setJournal((current) => {
        const last = current.at(-1)
        if (!last) return current
        setRedoable((stack) => [...stack, last])
        return current.slice(0, -1)
      })
      return stop()
    }
    if (key.name === "r" && key.ctrl) {
      setRedoable((stack) => {
        const last = stack.at(-1)
        if (!last) return stack
        setJournal((current) => [...current, last])
        return stack.slice(0, -1)
      })
      return stop()
    }
    if (key.name === "x" && selection.length > 0) {
      push({ op: "delete", ids: selection })
      setSelection([])
      return stop()
    }
    if (key.name === "n") {
      setMode({ kind: "connect" })
      setStatus("move to a port and press enter, then to the second port")
      return stop()
    }
    if (key.name === "a" && key.shift) {
      push({ op: "arrange" })
      return stop()
    }
    if (key.name === "tab") {
      setLayer((current) => (current + 1) % doc.layers.length)
      return stop()
    }
    if (key.name === "w") {
      if (journal.length === 0) setStatus("nothing to save")
      else {
        try {
          const sha = writeDoc(root, name, doc, `edit ${name} in the terminal`)
          setJournal([])
          setRedoable([])
          setRevision((n) => n + 1)
          setStatus(`saved ${sha}`)
        } catch (error) {
          setStatus(error instanceof BlueprintError ? error.message : String(error))
        }
      }
      return stop()
    }
    if (key.sequence === "+" || key.sequence === "=") {
      setView(zoom(view ?? rendered.view, 0.8))
      return stop()
    }
    if (key.sequence === "-" || key.sequence === "_") {
      setView(zoom(view ?? rendered.view, 1.25))
      return stop()
    }
    if (key.name === "0") {
      setView(undefined)
      return stop()
    }
    stop()
  })

  if (!loaded) return null
  if ("error" in loaded || !doc || !rendered) {
    return (
      <Modal>
        <box style={{ width: "100%", height: "100%", backgroundColor: theme.bg, padding: 2 }}>
          <text fg={theme.error}>{loaded && "error" in loaded ? loaded.error : "could not read that blueprint"}</text>
          <text fg={theme.dim}>esc to close</text>
        </box>
      </Modal>
    )
  }

  // Cursor and port marks go on after the drawing, so they are never mistaken for geometry.
  const marks: Cell[][] = rendered.cells.map((row) => [...row])
  const mark = (at: Pt, ch: string) => {
    const [col, row] = rendered.toCell(at)
    const target = marks[row]
    if (target?.[col]) target[col] = { ch, layer: undefined }
  }
  if (mode.kind === "connect") for (const part of doc.parts) for (const port of part.ports) mark(port, "○")
  for (const id of selection) {
    const entity = doc.entities.find((candidate) => candidate.id === id)
    if (entity?.type === "text") mark(entity.at, "▣")
  }
  if (mode.kind === "drag") mark(mode.from, "┌")
  mark(at, mode.kind === "drag" ? "┘" : "┼")

  const report = checkDoc(doc, domain)
  const errors = report.findings.filter((finding) => finding.severity === "error")
  const selected = selection.length === 1 ? doc.entities.find((entity) => entity.id === selection[0]) : undefined
  const symbolMatches = mode.kind === "symbols" ? searchSymbols({ query: mode.query }).slice(0, rows - 2) : []
  /** Truncated, not wrapped: a wrapped row costs two lines and shoves the search box off. */
  const fit = (text: string) => (text.length > cols ? `${text.slice(0, cols - 1)}…` : text)

  return (
    <Modal>
      <box style={{ width: "100%", height: "100%", backgroundColor: theme.bg, flexDirection: "column" }}>
        <box style={{ flexDirection: "row", flexGrow: 1 }}>
          {/* Tools, same ids and same keys as the web toolbar. */}
          <box style={{ width: RAIL, flexDirection: "column", flexShrink: 0, paddingLeft: 1 }}>
            <text fg={theme.accent}>{name}</text>
            {TOOLS.map((entry) => (
              <text
                key={entry.id}
                fg={entry.pointer ? theme.dim : entry.id === tool ? theme.accent : theme.muted}
              >
                {`${entry.id === tool ? "▸" : " "} ${entry.key}  ${entry.label}`}
              </text>
            ))}
            <box style={{ height: 1 }} />
            <text fg={theme.muted}>{"  n  connect"}</text>
            <text fg={theme.muted}>{"  A  arrange"}</text>
            <text fg={theme.muted}>{"  x  delete"}</text>
            <text fg={theme.muted}>{"  u  undo"}</text>
            <text fg={theme.muted}>{"  w  save"}</text>
          </box>

          {/* The drawing. */}
          <box style={{ flexGrow: 1, flexDirection: "column" }}>
            {mode.kind === "symbols" ? (
              <>
                <text fg={theme.accent}>{`symbol: ${mode.query}▌`}</text>
                {symbolMatches.map((match, index) => (
                  <text key={match.name} fg={index === mode.index ? theme.accent : theme.muted}>
                    {fit(`${index === mode.index ? "▸" : " "} ${match.name}  ${match.symbol.describe}`)}
                  </text>
                ))}
                {symbolMatches.length === 0 && <text fg={theme.dim}>no symbol matches that</text>}
              </>
            ) : (
              <Cells cells={marks} colours={palette(doc, theme)} fallback={theme.fg} />
            )}
          </box>

          {/* Layers, the selection, and the check — the web editor's three right panels. */}
          <box style={{ width: SIDE, flexDirection: "column", flexShrink: 0, paddingLeft: 1 }}>
            <text fg={theme.accent}>layers</text>
            {doc.layers.map((entry, index) => (
              <text key={entry.id} fg={index === layer ? theme.fg : theme.muted}>
                {`${index === layer ? "▸" : " "} ${entry.name}${entry.visible === false ? " (hidden)" : ""}`}
              </text>
            ))}
            <box style={{ height: 1 }} />
            <text fg={theme.accent}>selection</text>
            <text fg={theme.muted}>
              {selected
                ? `${selected.id}  ${selected.type}`
                : selection.length > 0
                  ? `${selection.length} entities`
                  : "nothing"}
            </text>
            <box style={{ height: 1 }} />
            <text fg={theme.accent}>{`check · ${domain}`}</text>
            <text fg={errors.length > 0 ? theme.error : theme.success}>
              {`${errors.length} errors · ${report.findings.length - errors.length} notes`}
            </text>
            {report.unchecked.length > 0 && (
              <text fg={theme.warning}>{`${report.unchecked.length} NOT CHECKED`}</text>
            )}
            {report.findings.slice(0, 6).map((finding, index) => (
              <text key={index} fg={finding.severity === "error" ? theme.error : theme.muted}>
                {`  ${finding.message}`}
              </text>
            ))}
          </box>
        </box>

        <text fg={theme.dim}>
          {` [${at[0].toFixed(1)}, ${at[1].toFixed(1)}] ${doc.units} · ${doc.entities.length} entities · ${doc.parts.length} parts · ${journal.length > 0 ? `${journal.length} unsaved` : "saved"} · enter draw · +/- zoom · ctrl+arrows pan · 0 fit · esc/q close`}
        </text>
        <text fg={status ? theme.warning : theme.dim}>{` ${status}`}</text>
      </box>
    </Modal>
  )
}
