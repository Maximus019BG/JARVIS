import { useTerminalDimensions } from "@opentui/react"
import type { Rgb } from "../../pi/items-client.ts"
import { rgbHex } from "./camera-canvas.tsx"
import { Modal } from "./dialog.tsx"

/** A rectangle to light up, in fractions of the whole screen. */
export type Spot = { box: { x: number; y: number; w: number; h: number }; rgb: Rgb; label?: string }

/**
 * The terminal as a projector over a table: black, with nothing on it but `spots` and a dim
 * line or two at the bottom. Black is what a projector shows as no light, so only the
 * rectangles land on the table. Fractions of the whole terminal, the same space `/calibrate`
 * maps the camera onto, so a resize keeps them in place.
 */
export function Projection({ spots, footer, colour }: { spots: readonly Spot[]; footer: readonly string[]; colour: string }) {
  const { width: columns, height: rows } = useTerminalDimensions()
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
  return (
    <Modal>
      <box style={{ width: "100%", height: "100%", backgroundColor: "#000000" }}>
        {spots.map((spot, index) => {
          // A border needs two cells each way; smaller would draw nothing.
          const left = clamp(Math.round(spot.box.x * columns), 0, columns - 2)
          const top = clamp(Math.round(spot.box.y * rows), 0, rows - 2)
          const width = clamp(Math.round(spot.box.w * columns), 2, columns - left)
          const height = clamp(Math.round(spot.box.h * rows), 2, rows - top)
          return (
            <box
              key={index}
              title={spot.label}
              titleColor={rgbHex(spot.rgb)}
              style={{ position: "absolute", left, top, width, height, border: true, borderStyle: "heavy", borderColor: rgbHex(spot.rgb) }}
            />
          )
        })}
        {footer.map((line, index) => (
          <text key={index} fg={colour} style={{ position: "absolute", left: 1, top: rows - footer.length + index }}>
            {line.slice(0, columns - 2)}
          </text>
        ))}
      </box>
    </Modal>
  )
}
