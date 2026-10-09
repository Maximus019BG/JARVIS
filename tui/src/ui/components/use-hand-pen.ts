import { useEffect, useRef, useState } from "react"
import { GestureReader, isFist, isOpenPalm, isPointing, oneEuro, pinchPoint, type GestureConfig, type GestureEvent, type Hand } from "../../pi/gestures.ts"
import type { Camera, HandSource, RemoteStats } from "../../pi/hand-source.ts"
import { GLYPHS } from "../use-gestures.ts"

export type HandSourceFactory = (onStats: (stats: RemoteStats) => void) => HandSource

export type HandPen = {
  camera?: Camera
  /** Smoothed pinch point in camera pixels; null with no hand in view. */
  cursor: [number, number] | null
  drawing: boolean
  /** What the camera reads right now — "no hand", "👆 point", "👍 thumbs_up" — so a pose that does nothing is visibly not seen. */
  seen?: string
  stats?: RemoteStats
  error?: string
}

/** What each pose does to the drawing, in the glyphs `readHand` reports, for the editor to list. */
export const HAND_LEGEND: [glyph: string, does: string][] = [
  ["🤏", "draw"],
  ["✋", "cancel"],
  ["✊", "undo"],
  ["👆", "hold: tool"],
  ["🤏🤏", "zoom"],
]

/** The pose the pen acts on, or the learned label when the server has the gesture model. */
export function readHand(hand: Hand | undefined, drawing: boolean): string {
  if (drawing) return "🤏 drawing"
  if (!hand) return "no hand"
  if (hand.gesture) return `${GLYPHS[hand.gesture.name] ?? ""} ${hand.gesture.name}`.trim()
  if (isFist(hand)) return "✊ fist"
  if (isOpenPalm(hand)) return "✋ palm"
  if (isPointing(hand)) return "👆 point"
  return "hand"
}

/**
 * Hand frames to pen events, for as long as `source` is set.
 *
 * The pinch point is One-Euro filtered before anything sees it — the cursor and the pen
 * share one filter, so a stroke starts exactly where the hovering cursor was. `onEvent`
 * is read through a ref, so a re-render never restarts the camera.
 */
export function useHandPen(options: {
  source: HandSourceFactory | undefined
  tuning: GestureConfig
  onEvent: (event: GestureEvent, t: number, camera: Camera) => void
}): HandPen {
  const [pen, setPen] = useState<HandPen>({ cursor: null, drawing: false })
  const onEvent = useRef(options.onEvent)
  onEvent.current = options.onEvent
  const tuning = useRef(options.tuning)
  tuning.current = options.tuning

  useEffect(() => {
    if (!options.source) {
      setPen({ cursor: null, drawing: false })
      return
    }
    let stopped = false
    let stats: RemoteStats | undefined
    const source = options.source((next) => {
      stats = next
      if (!stopped) setPen((current) => ({ ...current, stats: next }))
    })
    const reader = new GestureReader(tuning.current)
    const filter = oneEuro()
    let cursor: [number, number] | null = null
    setPen({ camera: source.camera, cursor: null, drawing: false, stats })

    void (async () => {
      try {
        for await (const frame of source.frames()) {
          if (stopped) return
          const hand = frame.hands.find((candidate) => candidate.score >= tuning.current.minScore)
          if (hand) cursor = filter.push(pinchPoint(hand), frame.t)
          else if (!reader.isDrawing) {
            filter.reset()
            cursor = null
          }
          for (const event of reader.push(frame)) {
            const smoothed = (event.type === "pen-down" || event.type === "pen-move") && cursor ? { ...event, at: cursor } : event
            onEvent.current(smoothed, frame.t, source.camera)
          }
          setPen({ camera: source.camera, cursor, drawing: reader.isDrawing, seen: readHand(hand, reader.isDrawing), stats })
        }
      } catch (error) {
        if (!stopped) setPen((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }))
      }
    })()

    return () => {
      stopped = true
      source.close()
    }
  }, [options.source])

  return pen
}
