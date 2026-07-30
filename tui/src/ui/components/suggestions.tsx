import type { Theme } from "../../config/theme.ts"
import type { Suggestion } from "../suggest.ts"

/**
 * The `/` and `@` completion strip. Purely presentational and never focused — the editor
 * keeps the cursor, and app.tsx intercepts the arrow keys before the textarea sees them.
 */
export function Suggestions({
  suggestion,
  selected,
  theme,
  hint,
}: {
  suggestion: Suggestion
  selected: number
  theme: Theme
  hint: string
}) {
  if (suggestion.choices.length === 0) return null

  // The widest label, so every row's highlight ends in the same column instead of being
  // ragged. Hints are appended after the padding, not inside it.
  const width = Math.max(...suggestion.choices.map((choice) => choice.label.length))

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
          >
            {` ${choice.label.padEnd(width)} `}
          </text>
          {choice.hint ? <text fg={theme.dim}>{`  ${choice.hint}`}</text> : null}
        </box>
      ))}
      <text fg={theme.hint}>{hint}</text>
    </box>
  )
}
