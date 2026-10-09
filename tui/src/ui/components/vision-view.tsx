import { RGBA, type BoxRenderable, type OptimizedBuffer } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import jpeg from "jpeg-js"
import { useEffect, useRef, useState } from "react"
import type { Credentials } from "../../blueprint/credentials.ts"
import type { Theme } from "../../config/theme.ts"
import { openFeed, type Feed } from "../../pi/camera.ts"
import { describeFound, findItems, teachItem, VisionError, type Box, type Found } from "../../pi/items-client.ts"
import { Modal } from "./dialog.tsx"

export type VisionMode = { kind: "learn"; name: string } | { kind: "find"; item?: string }

/** The preview's frame rate. The camera runs at 30; decoding every frame buys nothing a terminal can show. */
const PREVIEW_MS = 80
/** Holding space takes a burst at this spacing rather than twenty copies of one frame. */
const SHOT_GAP_MS = 250
const MIN_SHOTS = 3
const GOAL_SHOTS = 6
/** The server's cap. */
const MAX_SHOTS = 20

/** A frame scaled to the preview: `width` × `height` RGB pixels, two per terminal cell. */
type Pixels = { width: number; height: number; rgb: Uint8Array }

/** RGBA objects by 15-bit colour, so a frame of half-blocks allocates nothing after the first. */
const colours: (RGBA | undefined)[] = []
function colour(r: number, g: number, b: number): RGBA {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
  return (colours[key] ??= RGBA.fromInts(r & 0xf8, g & 0xf8, b & 0xf8, 255))
}

const hexRgb = (hex: string): [number, number, number] => {
  const [r, g, b] = RGBA.fromHex(hex).toInts()
  return [r, g, b]
}

/** Nearest-neighbour downscale of a decoded camera frame. ponytail: no averaging; a box filter if it shimmers. */
function scale(frame: { width: number; height: number; data: Uint8Array }, width: number, height: number): Pixels {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(frame.height - 1, Math.floor(((y + 0.5) * frame.height) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(frame.width - 1, Math.floor(((x + 0.5) * frame.width) / width))
      const from = (sy * frame.width + sx) * 3
      rgb.set(frame.data.subarray(from, from + 3), (y * width + x) * 3)
    }
  }
  return { width, height, rgb }
}

/** A one-pixel rectangle outline, in camera pixels, painted onto the scaled frame. */
function outline(pixels: Pixels, box: Box, camera: { width: number; height: number }, [r, g, b]: [number, number, number]) {
  const sx = pixels.width / camera.width
  const sy = pixels.height / camera.height
  const x0 = Math.max(0, Math.round(box.x * sx))
  const y0 = Math.max(0, Math.round(box.y * sy))
  const x1 = Math.min(pixels.width - 1, Math.round((box.x + box.w) * sx) - 1)
  const y1 = Math.min(pixels.height - 1, Math.round((box.y + box.h) * sy) - 1)
  const paint = (x: number, y: number) => pixels.rgb.set([r, g, b], (y * pixels.width + x) * 3)
  for (let x = x0; x <= x1; x++) {
    paint(x, y0)
    paint(x, y1)
  }
  for (let y = y0; y <= y1; y++) {
    paint(x0, y)
    paint(x1, y)
  }
}

/** Fits a camera frame into the terminal at two square pixels per cell. */
function fit(camera: { width: number; height: number }, columns: number, rows: number) {
  const aspect = camera.width / camera.height
  const cellRows = Math.max(4, Math.min(rows, Math.floor(columns / (2 * aspect))))
  return { columns: Math.max(8, Math.round(cellRows * 2 * aspect)), rows: cellRows }
}

const clampBox = (box: Box, camera: { width: number; height: number }): Box => {
  const w = Math.min(camera.width, Math.max(camera.width * 0.1, box.w))
  const h = Math.min(camera.height, Math.max(camera.height * 0.1, box.h))
  return { x: Math.min(camera.width - w, Math.max(0, box.x)), y: Math.min(camera.height - h, Math.max(0, box.y)), w, h }
}

/**
 * The webcam in the terminal, for teaching an item and for watching it get found. Learning is
 * "hold it in the box, press space, turn it, again": a box is all the server needs, and a
 * fixed one the user aims at is more reliable than any way of drawing one. Teaching lands in
 * find mode on the same item, so the first thing after teaching is seeing it work.
 */
export function VisionView({
  credentials,
  initial,
  threshold,
  theme,
  paused,
  onClose,
  onTaught,
}: {
  credentials: Credentials
  initial: VisionMode
  threshold?: number
  theme: Theme
  /** Something else owns the screen for now: draw nothing, take no keys, keep the shots. */
  paused?: boolean
  onClose: () => void
  onTaught: (name: string, samples: number) => void
}) {
  const { width: termColumns, height: termRows } = useTerminalDimensions()
  const [mode, setMode] = useState<VisionMode>(initial)
  const [feed, setFeed] = useState<Feed>()
  const [cameraError, setCameraError] = useState<string>()
  const [live, setLive] = useState(false)

  const camera = feed?.camera ?? { width: 480, height: 360 }
  const view = fit(camera, termColumns - 4, termRows - 7)
  const preview = useRef<BoxRenderable>(null)
  const frame = useRef<Pixels | undefined>(undefined)
  const labels = useRef<{ text: string; x: number; y: number }[]>([])

  // Learn mode.
  const [guide, setGuide] = useState<Box>({ x: camera.width * 0.3, y: camera.height * 0.225, w: camera.width * 0.4, h: camera.height * 0.55 })
  const shots = useRef<{ jpeg: Uint8Array; box: Box }[]>([])
  const [shotCount, setShotCount] = useState(0)
  const lastShot = useRef(0)
  const [teaching, setTeaching] = useState(false)
  const [status, setStatus] = useState<string>()

  // Find mode.
  const [found, setFound] = useState<{ items: Found[]; ms: number }>()
  const [findError, setFindError] = useState<string>()

  // The frame loop reads the terminal size without restarting the camera on a resize.
  const termColumnsRef = useRef(termColumns)
  termColumnsRef.current = termColumns
  const termRowsRef = useRef(termRows)
  termRowsRef.current = termRows

  /** Read by the frame loop, which outlives any one render. */
  const overlay = useRef({ mode, guide, found })
  overlay.current = { mode, guide, found }

  useEffect(() => {
    const opened = openFeed()
    setFeed(opened)
    let stopped = false
    void (async () => {
      let seq = -1
      let decodedAt = 0
      try {
        for (;;) {
          const shot = await opened.next(seq)
          if (stopped) return
          seq = shot.seq
          setLive(true)
          const now = performance.now()
          if (now - decodedAt < PREVIEW_MS) continue
          decodedAt = now
          let decoded: { width: number; height: number; data: Uint8Array }
          try {
            decoded = jpeg.decode(shot.jpeg, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 4 })
          } catch {
            continue
          }
          const target = fit(opened.camera, termColumnsRef.current - 4, termRowsRef.current - 7)
          const pixels = scale(decoded, target.columns, target.rows * 2)
          const { mode, guide, found } = overlay.current
          const next: { text: string; x: number; y: number }[] = []
          const toCell = (box: Box) => ({
            x: Math.floor((box.x / opened.camera.width) * target.columns),
            y: Math.max(0, Math.floor((box.y / opened.camera.height) * target.rows) - 1),
          })
          if (mode.kind === "learn") outline(pixels, guide, opened.camera, hexRgb(theme.accent))
          else
            for (const item of found?.items ?? [])
              for (const [index, box] of item.boxes.entries()) {
                outline(pixels, box, opened.camera, hexRgb(theme.success))
                if (index === 0) next.push({ text: ` ${item.name} ${box.score.toFixed(2)} `, ...toCell(box) })
              }
          frame.current = pixels
          labels.current = next
          preview.current?.requestRender()
        }
      } catch (error) {
        if (!stopped) setCameraError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      stopped = true
      opened.release()
    }
  }, [])

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

  const snap = () => {
    const shot = feed?.latest()
    const now = performance.now()
    if (!shot || now - lastShot.current < SHOT_GAP_MS || shots.current.length >= MAX_SHOTS) return
    lastShot.current = now
    shots.current.push({ jpeg: shot.jpeg, box: guide })
    setShotCount(shots.current.length)
    setStatus(undefined)
  }

  const teach = async (name: string) => {
    if (shots.current.length < MIN_SHOTS) {
      setStatus(`${MIN_SHOTS - shots.current.length} more shot${MIN_SHOTS - shots.current.length === 1 ? "" : "s"} first`)
      return
    }
    setTeaching(true)
    setStatus(`teaching ${name}…`)
    try {
      const taught = await teachItem(credentials, name, shots.current)
      shots.current = []
      setShotCount(0)
      setStatus(undefined)
      onTaught(taught.name, taught.samples)
      setMode({ kind: "find", item: taught.name })
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
    if (mode.kind !== "learn" || teaching) return stop()
    const step = { x: camera.width * 0.05, y: camera.height * 0.05 }
    const move = (dx: number, dy: number) => setGuide((box) => clampBox({ ...box, x: box.x + dx, y: box.y + dy }, camera))
    const grow = (factor: number) =>
      setGuide((box) =>
        clampBox({ x: box.x - (box.w * (factor - 1)) / 2, y: box.y - (box.h * (factor - 1)) / 2, w: box.w * factor, h: box.h * factor }, camera),
      )
    if (key.name === "space") snap()
    else if (key.name === "return") void teach(mode.name)
    else if (key.name === "backspace") {
      shots.current.pop()
      setShotCount(shots.current.length)
    } else if (key.name === "left") move(-step.x, 0)
    else if (key.name === "right") move(step.x, 0)
    else if (key.name === "up") move(0, -step.y)
    else if (key.name === "down") move(0, step.y)
    else if (key.sequence === "+" || key.sequence === "=") grow(1.1)
    else if (key.sequence === "-" || key.sequence === "_") grow(1 / 1.1)
    stop()
  })

  const draw = function (this: BoxRenderable, buffer: OptimizedBuffer) {
    const pixels = frame.current
    if (!pixels) return
    const rows = Math.min(this.height, pixels.height / 2)
    const columns = Math.min(this.width, pixels.width)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const top = (2 * y * pixels.width + x) * 3
        const bottom = top + pixels.width * 3
        const rgb = pixels.rgb
        buffer.setCell(
          this.x + x,
          this.y + y,
          "▀",
          colour(rgb[top]!, rgb[top + 1]!, rgb[top + 2]!),
          colour(rgb[bottom]!, rgb[bottom + 1]!, rgb[bottom + 2]!),
        )
      }
    }
    const fg = RGBA.fromHex(theme.bg)
    const bg = RGBA.fromHex(theme.success)
    for (const label of labels.current) buffer.drawText(label.text.slice(0, Math.max(0, columns - label.x)), this.x + label.x, this.y + label.y, fg, bg)
  }

  const title = mode.kind === "learn" ? ` teach · ${mode.name} ` : ` find · ${mode.item ?? "everything"} `
  const lines: { text: string; tone: keyof Theme }[] = []
  // Wrapped, not clipped: the end of a camera error is the part that says what to do.
  if (cameraError)
    for (let at = 0; at < cameraError.length; at += Math.max(20, view.columns))
      lines.push({ text: cameraError.slice(at, at + Math.max(20, view.columns)), tone: "error" })
  else if (!live) lines.push({ text: "starting the camera…", tone: "muted" })
  if (mode.kind === "learn") {
    const advice =
      shotCount === 0
        ? "hold it inside the box and press space"
        : shotCount < GOAL_SHOTS
          ? "turn it a little, or move it, then space again"
          : "enough to teach — more angles never hurt"
    lines.push({ text: `${shotCount}/${GOAL_SHOTS} shots — ${advice}`, tone: shotCount >= MIN_SHOTS ? "success" : "fg" })
    if (status) lines.push({ text: status, tone: teaching ? "accent" : "warning" })
  } else if (findError) lines.push({ text: findError, tone: "warning" })
  else if (found) {
    for (const item of found.items.slice(0, 3)) lines.push({ text: describeFound(item, camera), tone: item.found ? "success" : "muted" })
    lines.push({ text: `${found.ms}ms on the server`, tone: "dim" })
  } else if (live) lines.push({ text: "looking…", tone: "muted" })

  const keys =
    mode.kind === "learn"
      ? "space shot · backspace undo · enter teach · arrows move · +/- size · esc"
      : "esc close"

  if (paused) return null
  return (
    <Modal>
      <box
        title={title}
        titleColor={theme.accent}
        bottomTitle={` ${keys} `}
        style={{
          border: true,
          borderStyle: "rounded",
          borderColor: theme.accent,
          backgroundColor: theme.panel,
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <box ref={preview} renderAfter={draw} style={{ width: view.columns, height: view.rows, backgroundColor: theme.bg }} />
        {lines.map((line, index) => (
          <text key={index} fg={theme[line.tone]}>
            {line.text.slice(0, view.columns)}
          </text>
        ))}
      </box>
    </Modal>
  )
}
