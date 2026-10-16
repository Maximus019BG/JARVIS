import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import type { Theme } from "../../config/theme.ts"
import type { Rgb } from "../../pi/items-client.ts"
import { rgbHex } from "./camera-canvas.tsx"
import { Modal } from "./dialog.tsx"

/** A rectangle to light up, in fractions of the projected area. */
export type Spot = { box: { x: number; y: number; w: number; h: number }; rgb: Rgb; label?: string }

/** The side panel, as wide as the blueprint editor's. */
export const SIDE = 30
/** The status line and the key line under the picture. */
const FOOTER = 2

/** What the screen leaves for the picture: the terminal less the side panel and the footer. */
export const pictureArea = (columns: number, rows: number) => ({
  columns: Math.max(2, columns - SIDE),
  rows: Math.max(2, rows - FOOTER),
})

/**
 * The camera screens' layout, the blueprint editor's: the picture, a side panel on the right,
 * then a status line and a key line. `/learn`, `/find` and `/calibrate` share it in both views.
 */
export function Screen({
  picture,
  side,
  status,
  keys,
  colour,
  theme,
}: {
  picture: ReactNode
  side: ReactNode
  status: string
  keys: string
  /** The status line's colour: dim normally, a warning when it says something went wrong. */
  colour: string
  theme: Theme
}) {
  return (
    <Modal>
      <box style={{ width: "100%", height: "100%", backgroundColor: theme.bg, flexDirection: "column" }}>
        <box style={{ flexDirection: "row", flexGrow: 1, flexBasis: 0, overflow: "hidden" }}>
          {picture}
          <box style={{ width: SIDE, flexDirection: "column", flexShrink: 0, paddingLeft: 1, overflow: "hidden" }}>{side}</box>
        </box>
        <text fg={colour}>{` ${status}`}</text>
        <text fg={theme.dim}>{` ${keys}`}</text>
      </box>
    </Modal>
  )
}

/**
 * The terminal as a projector over a table: the picture area is black with nothing on it but
 * `spots`, since black is what a projector shows as no light, so only the rectangles land on
 * the table. Fractions of that area, the same space `/calibrate` maps the camera onto, so a
 * resize keeps them in place.
 */
export function Projection({ spots, ...screen }: { spots: readonly Spot[] } & Omit<Parameters<typeof Screen>[0], "picture">) {
  const { width, height } = useTerminalDimensions()
  const { columns, rows } = pictureArea(width, height)
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
  const picture = (
    <box style={{ width: columns, height: rows, flexShrink: 0, backgroundColor: "#000000" }}>
      {spots.map((spot, index) => {
        // A border needs two cells each way; smaller would draw nothing.
        const left = clamp(Math.round(spot.box.x * columns), 0, columns - 2)
        const top = clamp(Math.round(spot.box.y * rows), 0, rows - 2)
        const w = clamp(Math.round(spot.box.w * columns), 2, columns - left)
        const h = clamp(Math.round(spot.box.h * rows), 2, rows - top)
        return (
          <box
            key={index}
            title={spot.label}
            titleColor={rgbHex(spot.rgb)}
            style={{ position: "absolute", left, top, width: w, height: h, border: true, borderStyle: "heavy", borderColor: rgbHex(spot.rgb) }}
          />
        )
      })}
    </box>
  )
  return <Screen picture={picture} {...screen} />
}
