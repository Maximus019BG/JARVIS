import { useTerminalDimensions } from "@opentui/react"
import type { Theme } from "../../config/theme.ts"
import type { Suggestion } from "../suggest.ts"
import { clip } from "./dialog.tsx"

/**
 * The `/` and `@` completion strip. Purely presentational and never focused — the editor
 * keeps the cursor, and app.tsx intercepts the arrow keys before the textarea sees them.
 */
export function Suggestions({
  suggestion,
  selected,
  theme,
}: {
  suggestion: Suggestion
  selected: number
  theme: Theme
}) {
  if (suggestion.choices.length === 0) return null

  // Nothing here may exceed the terminal: a row that overflows makes opentui wrap each
  // `<text>` on its own, which splits `/export` into `/` and `export` on separate lines and
  // scatters the hint's words through the padding. Clip instead of wrapping.
  const { width: columns } = useTerminalDimensions()
  // The strip's own padding, plus the two spaces the highlight puts around every label.
  const labels = suggestion.choices.map((choice) => clip(choice.label, Math.max(8, columns - 6)))

  // The widest label, so every row's highlight ends in the same column instead of being
  // ragged. Hints are appended after the padding, not inside it.
  const width = Math.max(...labels.map((label) => label.length))
  // What the hint gets after the label and its two-space gap. Too few columns to say
  // anything is better spent showing none, so the label stays on one line.
  const room = columns - width - 8

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        backgroundColor: theme.panel,
        paddingLeft: 2,
        paddingRight: 2,
        // No paddingBottom: the transcript above grows to fill, so a trailing pad row gets
        // squeezed out anyway, and the editor's border already separates the two.
        paddingTop: 1,
      }}
    >
      {suggestion.choices.map((choice, index) => (
        <box key={choice.value} style={{ flexDirection: "row" }}>
          {/* The spaces are inside the highlighted span so the selected row is not flush
              against its own text. */}
          <text
            fg={index === selected ? theme.fg : theme.muted}
            bg={index === selected ? theme.selection : theme.panel}
            style={{ flexShrink: 0 }}
          >
            {` ${labels[index]!.padEnd(width)} `}
          </text>
          {choice.hint && room > 8 ? <text fg={theme.dim}>{`  ${clip(choice.hint, room)}`}</text> : null}
        </box>
      ))}
    </box>
  )
}
