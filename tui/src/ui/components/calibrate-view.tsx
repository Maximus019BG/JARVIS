import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useMemo, useRef, useState } from "react"
import type { Credentials } from "../../blueprint/credentials.ts"
import type { Theme } from "../../config/theme.ts"
import { calibrate, findCalibrationPath, saveCalibration, TARGETS, type Pt } from "../../pi/calibration.ts"
import { DEFAULT_GESTURES } from "../../pi/gestures.ts"
import { remoteSource } from "../../pi/hand-source.ts"
import { hexRgb } from "./camera-canvas.tsx"
import { wrapText } from "./dialog.tsx"
import { pictureArea, Projection, SIDE } from "./projection.tsx"
import { useHandPen, type HandSourceFactory } from "./use-hand-pen.ts"

/** The marker, in cells: wide enough to pinch the middle of, small enough to be precise. */
const MARKER = { columns: 5, rows: 3 }

/**
 * `/calibrate`: where the projected screen lands in the camera, so `/find` and `/learn` can
 * light up the real thing. The four `jarvis pi` targets, one at a time, on black; a pinch on
 * each records where the camera saw it. The solved mapping goes camera pixels → fractions of
 * the black area beside the side panel (the same layout `/find` uses), so it survives a
 * terminal resize. Redo it whenever the projector or camera moves.
 */
export function CalibrateView({
  credentials,
  theme,
  paused,
  onClose,
}: {
  credentials: Credentials
  theme: Theme
  paused?: boolean
  onClose: () => void
}) {
  const { width: columns, height: rows } = useTerminalDimensions()
  const captured = useRef<Pt[]>([])
  const [count, setCount] = useState(0)
  const [result, setResult] = useState<{ text: string; ok: boolean }>()

  const source = useMemo<HandSourceFactory>(
    () => (onStats) => remoteSource({ baseUrl: credentials.baseUrl, token: credentials.token, onStats }),
    [credentials],
  )
  const tuning = useMemo(() => ({ ...DEFAULT_GESTURES, lostFrames: 3 }), [])

  const pen = useHandPen({
    source: paused || result?.ok ? undefined : source,
    tuning,
    onEvent: (event, _t, camera) => {
      // Only the moment of contact counts; a drag afterwards is noise.
      if (event.type !== "pen-down") return
      captured.current.push(event.at)
      setCount(captured.current.length)
      if (captured.current.length < TARGETS.length) return
      const outcome = calibrate(captured.current, camera, { width: 1, height: 1 }, new Date().toISOString())
      captured.current = []
      setCount(0)
      if ("error" in outcome) return setResult({ text: `${outcome.error} — pinch the markers again`, ok: false })
      try {
        saveCalibration(outcome.calibration, findCalibrationPath)
      } catch (error) {
        return setResult({ text: error instanceof Error ? error.message : String(error), ok: false })
      }
      const off = (outcome.calibration.error * 100).toFixed(1)
      setResult({ text: `calibrated — off by ${off}% of the screen on average`, ok: true })
    },
  })

  useKeyboard((key) => {
    if (paused) return
    if (key.name === "escape" || (result?.ok && key.name === "return")) onClose()
    else if (key.name === "backspace") {
      captured.current.pop()
      setCount(captured.current.length)
    } else if (key.name === "r") {
      captured.current = []
      setCount(0)
      setResult(undefined)
    }
    key.stopPropagation()
  })

  if (paused) return null

  const [fx, fy] = TARGETS[count]!
  const area = pictureArea(columns, rows)
  const w = MARKER.columns / area.columns
  const h = MARKER.rows / area.rows
  const spots = result?.ok ? [] : [{ box: { x: fx - w / 2, y: fy - h / 2, w, h }, rgb: hexRgb(theme.accent), label: `${count + 1}` }]
  const status = result?.text ?? pen.error ?? ""
  const keys = result?.ok ? "enter/esc close · r redo" : "backspace undo · r restart · esc cancel"
  const lines = (text: string, fg: string, key: string) =>
    wrapText(text, SIDE - 2).map((line, index) => (
      <text key={`${key}${index}`} fg={fg}>
        {line}
      </text>
    ))
  const side = (
    <>
      <text fg={theme.accent}>calibrate</text>
      <box style={{ height: 1 }} />
      {result?.ok ? (
        <text fg={theme.success}>calibrated</text>
      ) : (
        <>
          <text fg={theme.fg}>{`marker ${count + 1}/${TARGETS.length}`}</text>
          {lines("pinch the middle of the lit marker", theme.muted, "p")}
        </>
      )}
      <box style={{ height: 1 }} />
      {lines(pen.seen ?? "starting the camera…", theme.dim, "s")}
      <box style={{ height: 1 }} />
      {lines("redo whenever the projector or the camera moves", theme.dim, "r")}
    </>
  )

  return (
    <Projection
      spots={spots}
      side={side}
      status={status}
      keys={keys}
      colour={result && !result.ok ? theme.warning : theme.dim}
      theme={theme}
    />
  )
}
