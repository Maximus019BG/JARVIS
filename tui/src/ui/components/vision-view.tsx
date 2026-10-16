import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Credentials } from "../../blueprint/credentials.ts"
import type { Theme } from "../../config/theme.ts"
import { findCalibrationPath, matrixOf, toScreen, usableCalibration, type Homography } from "../../pi/calibration.ts"
import { openFeed, type Feed } from "../../pi/camera.ts"
import { findItems, itemColours, listItems, teachItem, VisionError, where, type Box, type Found, type Taught } from "../../pi/items-client.ts"
import { CameraCanvas, fit, hexRgb, rgbHex, type Mark } from "./camera-canvas.tsx"
import { Modal } from "./dialog.tsx"
import { Projection, type LegendRow, type Spot } from "./projection.tsx"

/** `calibrate` is its own screen (`calibrate-view.tsx`); the other two are this one. */
export type VisionMode = { kind: "learn"; name: string } | { kind: "find"; item?: string } | { kind: "calibrate" }
type Mode = Exclude<VisionMode, { kind: "calibrate" }>

/** Holding space takes a burst at this spacing rather than twenty copies of one frame. */
const SHOT_GAP_MS = 250
const MIN_SHOTS = 3
const GOAL_SHOTS = 6
/** The server's cap. */
const MAX_SHOTS = 20
/** The side panel, as wide as the blueprint editor's. */
const SIDE = 30

const clampBox = (box: Box, camera: { width: number; height: number }): Box => {
  const w = Math.min(camera.width, Math.max(camera.width * 0.1, box.w))
  const h = Math.min(camera.height, Math.max(camera.height * 0.1, box.h))
  return { x: Math.min(camera.width - w, Math.max(0, box.x)), y: Math.min(camera.height - h, Math.max(0, box.y)), w, h }
}

/** Wrapped, not clipped: the end of a camera error is the part that says what to do. */
const wrap = (text: string, width: number) => Array.from({ length: Math.ceil(text.length / width) }, (_, at) => text.slice(at * width, (at + 1) * width))

/** `/calibrate`'s mapping for this camera, or undefined: missing, unreadable, or from another resolution. */
function projectorMatrix(camera: { width: number; height: number }): Homography | undefined {
  try {
    const usable = usableCalibration(camera, findCalibrationPath)
    return "calibration" in usable ? matrixOf(usable.calibration) : undefined
  } catch {
    return undefined
  }
}

/**
 * The webcam full screen, laid out like the blueprint editor: the picture, a side panel, a
 * status line and the keys. Learning is "hold it in the box, press space, turn it, again": a
 * box is all the server needs, and a fixed one the user aims at is more reliable than any way
 * of drawing one. Finding outlines every taught item where it is, each in its own colour, with
 * the same colour against its row in the panel. Teaching lands in find mode on the same item,
 * so the first thing after teaching is seeing it work.
 *
 * Two views of the same thing, `c` switching between them. The camera view is the above. The
 * projector view is for the terminal projected over a table: black, with only the guide box or
 * the found items lit, placed through `/calibrate`'s mapping so they land on the real things.
 */
export function VisionView({
  credentials,
  initial,
  camera: cameraView,
  threshold,
  theme,
  paused,
  onClose,
  onTaught,
}: {
  credentials: Credentials
  initial: Mode
  /** Open on the camera picture rather than the projector view. */
  camera?: boolean
  threshold?: number
  theme: Theme
  /** Something else owns the screen for now: draw nothing, take no keys, keep the shots. */
  paused?: boolean
  onClose: () => void
  onTaught: (name: string, samples: number) => void
}) {
  const { width: termColumns, height: termRows } = useTerminalDimensions()
  const [mode, setMode] = useState<Mode>(initial)
  const [showCamera, setShowCamera] = useState(Boolean(cameraView))
  const [feed, setFeed] = useState<Feed>()
  const [cameraError, setCameraError] = useState<string>()
  const [live, setLive] = useState(false)

  const camera = feed?.camera ?? { width: 480, height: 360 }
  const view = fit(camera, termColumns - SIDE - 2, termRows - 3)
  const matrix = useMemo(() => projectorMatrix(camera), [camera.width, camera.height])

  // Learn mode.
  const [guide, setGuide] = useState<Box>({ x: camera.width * 0.3, y: camera.height * 0.225, w: camera.width * 0.4, h: camera.height * 0.55 })
  /** A null box is a shot of the empty spot: the server keeps what is behind the item out of it. */
  const shots = useRef<{ jpeg: Uint8Array; box: Box | null }[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [hasBackground, setHasBackground] = useState(false)
  const lastShot = useRef(0)
  const [teaching, setTeaching] = useState(false)
  const [status, setStatus] = useState<string>()

  // Find mode.
  const [found, setFound] = useState<{ items: Found[]; ms: number }>()
  const [findError, setFindError] = useState<string>()
  /** Every taught item, so colours hold still and the panel lists what is filtered out too. */
  const [taught, setTaught] = useState<Taught[]>()
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    const opened = openFeed()
    setFeed(opened)
    return () => opened.release()
  }, [])

  // Fetched again after a teach, which may have added one. A failure leaves the panel to the
  // find results; the find loop says what went wrong.
  const refresh = () => void listItems(credentials).then(setTaught, () => {})
  useEffect(refresh, [])

  // Find: one request in flight, always on the newest frame, so the boxes lag by one round trip.
  const findItem = mode.kind === "find" ? mode.item : undefined
  useEffect(() => {
    if (!feed || mode.kind !== "find") return
    let stopped = false
    setFound(undefined)
    setFindError(undefined)
    void (async () => {
      let seq = -1
      while (!stopped) {
        try {
          const shot = await feed.next(seq)
          seq = shot.seq
          const result = await findItems(credentials, shot.jpeg, { item: findItem, threshold })
          if (stopped) return
          setFound(result)
          setFindError(undefined)
        } catch (error) {
          if (stopped) return
          const message = error instanceof Error ? error.message : String(error)
          setFindError(message)
          // Nothing to find, no access, no model: asking again will not change the answer.
          if (error instanceof VisionError) return
          await Bun.sleep(1000)
        }
      }
    })()
    return () => {
      stopped = true
    }
  }, [feed, mode.kind, findItem])

  const listed = useMemo(
    () => [...(taught ?? found?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [taught, found],
  )
  const colourOf = useMemo(() => itemColours(listed), [listed])
  const results = new Map(found?.items.map((item) => [item.id, item]))
  const row = Math.min(selected, Math.max(0, listed.length - 1))
  /** The items panel's rows, shared by the camera view's side panel and the projector's legend. */
  const legend = listed.map((item) => {
    const result = results.get(item.id)
    const box = result?.boxes[0]
    const place = box ? where(box, camera) : result ? `not in view (best ${result.best.toFixed(2)})` : found ? "not shown" : ""
    return { item, box, place }
  })

  const marks: Mark[] =
    mode.kind === "learn"
      ? [{ box: guide, rgb: hexRgb(theme.accent) }]
      : (found?.items ?? []).flatMap((item) =>
          item.boxes.map((box, index) => ({
            box,
            rgb: colourOf(item.id),
            label: index === 0 ? ` ${item.name} ${box.score.toFixed(2)} ` : undefined,
          })),
        )

  const counted = () => {
    setShotCount(shots.current.filter((shot) => shot.box).length)
    setHasBackground(shots.current.some((shot) => !shot.box))
  }

  const snap = (box: Box | null) => {
    const shot = feed?.latest()
    const now = performance.now()
    if (!shot) return setStatus("no picture from the camera yet")
    if (now - lastShot.current < SHOT_GAP_MS || shots.current.length >= MAX_SHOTS) return
    lastShot.current = now
    shots.current.push({ jpeg: shot.jpeg, box })
    counted()
    setStatus(undefined)
  }

  const teach = async (name: string) => {
    if (!shots.current.some((shot) => !shot.box)) return setStatus("first a shot with nothing in the box — press b")
    const missing = MIN_SHOTS - shots.current.filter((shot) => shot.box).length
    if (missing > 0) return setStatus(`${missing} more shot${missing === 1 ? "" : "s"} first`)
    setTeaching(true)
    setStatus(`teaching ${name}…`)
    try {
      const done = await teachItem(credentials, name, shots.current)
      shots.current = []
      counted()
      setStatus(undefined)
      onTaught(done.name, done.samples)
      refresh()
      setMode({ kind: "find", item: done.name })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setTeaching(false)
    }
  }

  useKeyboard((key) => {
    if (paused) return
    const stop = () => key.stopPropagation()
    if (key.name === "escape" || (mode.kind === "find" && key.name === "q")) {
      onClose()
      return stop()
    }
    if (key.name === "c" && !teaching) {
      setShowCamera((shown) => !shown)
      return stop()
    }
    if (mode.kind === "find") {
      if (key.name === "up") setSelected(Math.max(0, row - 1))
      else if (key.name === "down") setSelected(Math.min(listed.length - 1, row + 1))
      else if (key.name === "return" && listed[row]) setMode({ kind: "find", item: listed[row].name })
      else if (key.name === "a") setMode({ kind: "find" })
      return stop()
    }
    if (teaching) return stop()
    const step = { x: camera.width * 0.05, y: camera.height * 0.05 }
    const move = (dx: number, dy: number) => setGuide((box) => clampBox({ ...box, x: box.x + dx, y: box.y + dy }, camera))
    const grow = (factor: number) =>
      setGuide((box) =>
        clampBox({ x: box.x - (box.w * (factor - 1)) / 2, y: box.y - (box.h * (factor - 1)) / 2, w: box.w * factor, h: box.h * factor }, camera),
      )
    if (key.name === "space") snap(guide)
    else if (key.name === "b") snap(null)
    else if (key.name === "return") void teach(mode.name)
    else if (key.name === "backspace") {
      shots.current.pop()
      counted()
    } else if (key.name === "left") move(-step.x, 0)
    else if (key.name === "right") move(step.x, 0)
    else if (key.name === "up") move(0, -step.y)
    else if (key.name === "down") move(0, step.y)
    else if (key.sequence === "+" || key.sequence === "=") grow(1.1)
    else if (key.sequence === "-" || key.sequence === "_") grow(1 / 1.1)
    stop()
  })

  if (paused) return null

  const width = SIDE - 2
  const clip = (text: string) => (text.length > width ? `${text.slice(0, width - 1)}…` : text)
  const title = mode.kind === "learn" ? `teach · ${mode.name}` : `find · ${mode.item ?? "everything"}`
  const footer = mode.kind === "learn" ? (status ?? "") : (findError ?? (found ? `${found.ms}ms on the server` : live ? "looking…" : ""))
  const keys =
    mode.kind === "learn"
      ? " b empty shot · space shot · backspace undo · enter teach · arrows move · +/- size · c projector · esc close"
      : " ↑↓ pick · enter only this · a all · c projector · esc/q close"

  const advice = !hasBackground
    ? "clear the box, then press b — a shot of what is behind the item"
    : shotCount === 0
      ? "hold it inside the box and press space"
      : shotCount < GOAL_SHOTS
        ? "turn it a little, or move it, then space again"
        : "enough to teach — more angles never hurt"

  if (!showCamera) {
    const spots: Spot[] =
      mode.kind === "learn"
        ? [{ box: toScreen(guide, camera, matrix), rgb: hexRgb(theme.accent), label: ` ${mode.name} ${shotCount}/${GOAL_SHOTS} ` }]
        : (found?.items ?? []).flatMap((item) =>
            item.boxes.map((box, index) => ({
              box: toScreen(box, camera, matrix),
              rgb: colourOf(item.id),
              label: index === 0 ? ` ${item.name} ` : undefined,
            })),
          )
    const message =
      mode.kind === "learn"
        ? (cameraError ?? status ?? `${shotCount}/${GOAL_SHOTS} shots — ${advice}`)
        : (findError ?? (found ? `${found.items.filter((item) => item.found).length}/${found.items.length} in view` : "looking…"))
    const projectorKeys =
      mode.kind === "learn"
        ? "b empty shot · space shot · backspace undo · enter teach · arrows move · +/- size · c camera · esc close"
        : "↑↓ pick · enter only this · a all · c camera · esc/q close"
    const legendRows: LegendRow[] =
      mode.kind === "find"
        ? legend.map(({ item, box, place }, index) => ({
            rgb: colourOf(item.id),
            on: Boolean(box),
            text: `${index === row ? "▸" : " "} ${item.name}${place ? ` · ${place}` : ""}`,
            colour: index === row ? theme.fg : box ? theme.muted : theme.dim,
          }))
        : []
    return (
      <Projection
        spots={spots}
        legend={legendRows}
        footer={[`${title} · ${message}${matrix ? "" : " · not calibrated — /calibrate"}`, projectorKeys]}
        colour={theme.dim}
      />
    )
  }

  return (
    <Modal>
      <box style={{ width: "100%", height: "100%", backgroundColor: theme.bg, flexDirection: "column" }}>
        <box style={{ flexDirection: "row", flexGrow: 1, flexBasis: 0, overflow: "hidden" }}>
          <box style={{ flexGrow: 1, flexDirection: "column", alignItems: "center", paddingLeft: 1 }}>
            {feed && (
              <CameraCanvas
                feed={feed}
                columns={view.columns}
                rows={view.rows}
                marks={marks}
                theme={theme}
                onLive={() => setLive(true)}
                onError={setCameraError}
              />
            )}
          </box>

          <box style={{ width: SIDE, flexDirection: "column", flexShrink: 0, paddingLeft: 1, overflow: "hidden" }}>
            <text fg={theme.accent}>{clip(title)}</text>
            {cameraError && wrap(cameraError, width).map((line, index) => <text key={`e${index}`} fg={theme.error}>{line}</text>)}
            {!cameraError && !live && <text fg={theme.muted}>starting the camera…</text>}
            <box style={{ height: 1 }} />
            {mode.kind === "learn" ? (
              <>
                <text fg={shotCount >= MIN_SHOTS && hasBackground ? theme.success : theme.fg}>
                  {`${shotCount}/${GOAL_SHOTS} shots · empty ${hasBackground ? "✓" : "—"}`}
                </text>
                {wrap(advice, width).map((line, index) => (
                  <text key={`a${index}`} fg={theme.muted}>
                    {line}
                  </text>
                ))}
              </>
            ) : (
              <>
                <text fg={theme.accent}>items</text>
                {listed.length === 0 && <text fg={theme.dim}>{taught ? "nothing taught — /learn <name>" : "…"}</text>}
                {legend.map(({ item, box, place }, index) => (
                  <box key={item.id} style={{ flexDirection: "column", flexShrink: 0 }}>
                    <text fg={index === row ? theme.fg : theme.muted}>
                      {index === row ? "▸ " : "  "}
                      <span fg={rgbHex(colourOf(item.id))}>{box ? "■" : "□"}</span>
                      {clip(` ${item.name}${box ? ` ${box.score.toFixed(2)}` : ""}`).slice(0, width - 3)}
                    </text>
                    {place && <text fg={box ? theme.success : theme.dim}>{clip(`    ${place}`)}</text>}
                  </box>
                ))}
              </>
            )}
          </box>
        </box>
        <text fg={findError || (mode.kind === "learn" && status) ? (teaching ? theme.accent : theme.warning) : theme.dim}>{` ${footer}`}</text>
        <text fg={theme.dim}>{keys}</text>
      </box>
    </Modal>
  )
}
