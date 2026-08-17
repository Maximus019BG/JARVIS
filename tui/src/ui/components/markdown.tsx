import { RGBA, SyntaxStyle } from "@opentui/core"
import type { Theme } from "../../config/theme.ts"

const cache = new Map<Theme, SyntaxStyle>()

/** Syntax colors for fenced code blocks, derived from the active theme. */
export function syntaxStyle(theme: Theme): SyntaxStyle {
  const cached = cache.get(theme)
  if (cached) return cached
  const style = SyntaxStyle.fromStyles({
    keyword: { fg: RGBA.fromHex(theme.accent) },
    string: { fg: RGBA.fromHex(theme.success) },
    number: { fg: RGBA.fromHex(theme.code) },
    comment: { fg: RGBA.fromHex(theme.muted), italic: true },
    type: { fg: RGBA.fromHex(theme.warning) },
    function: { fg: RGBA.fromHex(theme.tool) },
    variable: { fg: RGBA.fromHex(theme.fg) },
    punctuation: { fg: RGBA.fromHex(theme.muted) },
    default: { fg: RGBA.fromHex(theme.fg) },
  })
  cache.set(theme, style)
  return style
}

/**
 * opentui ships a markdown renderable; this only supplies theme colors and the
 * streaming flag, which must stay true while text is still arriving.
 */
export function Markdown({ text, theme, streaming }: { text: string; theme: Theme; streaming?: boolean }) {
  return (
    <markdown
      content={text}
      syntaxStyle={syntaxStyle(theme)}
      streaming={streaming ?? false}
      fg={theme.fg}
      style={{ width: "100%" }}
    />
  )
}
