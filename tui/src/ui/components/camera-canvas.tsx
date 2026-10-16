import { RGBA, type BoxRenderable, type OptimizedBuffer } from "@opentui/core"
import jpeg from "jpeg-js"
import { useEffect, useRef } from "react"
import type { Theme } from "../../config/theme.ts"
import type { Feed } from "../../pi/camera.ts"
import type { Box, Rgb } from "../../pi/items-client.ts"

/**
 * Something to point at in the picture: an unfilled rectangle in camera pixels, and an optional
 * label chip on its top edge. Items, the teach guide, and whatever detects things next all speak this.
 */
export type Mark = { box: Box; rgb: Rgb; label?: string }

/** The preview's frame rate. The camera runs at 30; decoding every frame buys nothing a terminal can show. */
const PREVIEW_MS = 80

/** A frame scaled to the preview: `width` × `height` RGB pixels, two per terminal cell. */
type Pixels = { width: number; height: number; rgb: Uint8Array }

/** RGBA objects by 15-bit colour, so a frame of half-blocks allocates nothing after the first. */
const colours: (RGBA | undefined)[] = []
function colour(r: number, g: number, b: number): RGBA {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
  return (colours[key] ??= RGBA.fromInts(r & 0xf8, g & 0xf8, b & 0xf8, 255))
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
function outline(pixels: Pixels, box: Box, camera: { width: number; height: number }, [r, g, b]: Rgb) {
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

/** Fits a camera frame into `columns` × `rows` cells at two square pixels per cell. */
export function fit(camera: { width: number; height: number }, columns: number, rows: number) {
  const aspect = camera.width / camera.height
  const cellRows = Math.max(4, Math.min(rows, Math.floor(columns / (2 * aspect))))
  return { columns: Math.max(8, Math.round(cellRows * 2 * aspect)), rows: cellRows }
}

export const hexRgb = (hex: string): Rgb => {
  const [r, g, b] = RGBA.fromHex(hex).toInts()
  return [r, g, b]
}

export const rgbHex = (rgb: Rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`

/**
 * The live camera in half-blocks, `columns` × `rows` cells, with `marks` outlined over it. The
 * frame loop reads the size and the marks through refs, so neither a resize nor new marks
 * restarts it; it stops with the component, the feed is the caller's.
 */
export function CameraCanvas({
  feed,
  columns,
  rows,
  marks,
  theme,
  onLive,
  onError,
}: {
  feed: Feed
  columns: number
  rows: number
  marks: readonly Mark[]
  theme: Theme
  onLive: () => void
  onError: (message: string) => void
}) {
  const preview = useRef<BoxRenderable>(null)
  const frame = useRef<Pixels | undefined>(undefined)
  const labels = useRef<{ text: string; x: number; y: number; rgb: Rgb }[]>([])
  const latest = useRef({ columns, rows, marks, onLive, onError })
  latest.current = { columns, rows, marks, onLive, onError }

  useEffect(() => {
    let stopped = false
    void (async () => {
      let seq = -1
      let decodedAt = 0
      try {
        for (;;) {
          const shot = await feed.next(seq)
          if (stopped) return
          seq = shot.seq
          latest.current.onLive()
          const now = performance.now()
          if (now - decodedAt < PREVIEW_MS) continue
          decodedAt = now
          let decoded: { width: number; height: number; data: Uint8Array }
          try {
            decoded = jpeg.decode(shot.jpeg, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 4 })
          } catch {
            continue
          }
          const { columns, rows, marks } = latest.current
          const pixels = scale(decoded, columns, rows * 2)
          const next: typeof labels.current = []
          for (const mark of marks) {
            outline(pixels, mark.box, feed.camera, mark.rgb)
            if (mark.label)
              next.push({
                text: mark.label,
                x: Math.floor((mark.box.x / feed.camera.width) * columns),
                y: Math.max(0, Math.floor((mark.box.y / feed.camera.height) * rows) - 1),
                rgb: mark.rgb,
              })
          }
          frame.current = pixels
          labels.current = next
          preview.current?.requestRender()
        }
      } catch (error) {
        if (!stopped) latest.current.onError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      stopped = true
    }
  }, [feed])

  const draw = function (this: BoxRenderable, buffer: OptimizedBuffer) {
    const pixels = frame.current
    if (!pixels) return
    const height = Math.min(this.height, pixels.height / 2)
    const width = Math.min(this.width, pixels.width)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
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
    const ink = colour(0, 0, 0)
    for (const label of labels.current)
      buffer.drawText(label.text.slice(0, Math.max(0, width - label.x)), this.x + label.x, this.y + label.y, ink, colour(...label.rgb))
  }

  return <box ref={preview} renderAfter={draw} style={{ width: columns, height: rows, backgroundColor: theme.bg }} />
}
