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

  return (
    <box style={{ flexDirection: "column", width: "100%", backgroundColor: theme.panel, paddingLeft: 1 }}>
      {suggestion.choices.map((choice, index) => (
        <text
          key={choice.value}
          fg={index === selected ? theme.fg : theme.muted}
          bg={index === selected ? theme.selection : theme.panel}
        >
          {`${choice.label}${choice.hint ? `  ${choice.hint}` : ""}`}
        </text>
      ))}
      <text fg={theme.hint}>{hint}</text>
    </box>
  )
}
