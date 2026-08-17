import { basename } from "node:path"
import { readFileSync } from "node:fs"
import { resourceFiles } from "./discover.ts"

/**
 * The full set of colors the UI can use. Any theme file may override a subset;
 * missing tokens fall back to the built-in dark theme.
 */
export type Theme = {
  bg: string
  panel: string
  fg: string
  muted: string
  /** Keybinding hints and the welcome block: quieter than `fg`, louder than `muted`. */
  hint: string
  /** Reasoning blocks and other text the user can safely skip. */
  dim: string
  border: string
  accent: string
  user: string
  assistant: string
  tool: string
  success: string
  error: string
  warning: string
  diffAdd: string
  diffRemove: string
  code: string
  codeBg: string
  selection: string
}

export const THEMES: Record<string, Theme> = {
  /**
   * Neutral graphite. Every surface, text and border token is a true grey — equal parts red,
   * green and blue — so the only colour on screen is the colour that means something: the green
   * accent, the diff pair, and the orange of inline code.
   *
   * Brightness is carried over from the previous blue-grey palette rather than re-picked, so the
   * contrast ratios and the ordering of the surfaces (bg darker than panel darker than codeBg)
   * are unchanged; only the hue is gone.
   */
  jarvis: {
    bg: "#0d0d0d",
    panel: "#1a1a1a",
    fg: "#d4d4d4",
    muted: "#757575",
    hint: "#949494",
    dim: "#5f5f5f",
    border: "#333333",
    accent: "#46d892",
    user: "#7ee787",
    assistant: "#d4d4d4",
    tool: "#8bd8b0",
    success: "#3fb950",
    error: "#f85149",
    warning: "#d29922",
    diffAdd: "#3fb950",
    diffRemove: "#f85149",
    code: "#ffa657",
    codeBg: "#1f1f1f",
    selection: "#145c3b",
  },
  light: {
    bg: "#ffffff",
    panel: "#f6f8fa",
    fg: "#24292f",
    muted: "#6e7781",
    hint: "#57606a",
    dim: "#8c959f",
    border: "#d0d7de",
    accent: "#0f844b",
    user: "#1a7f37",
    assistant: "#24292f",
    tool: "#12733f",
    success: "#1a7f37",
    error: "#cf222e",
    warning: "#9a6700",
    diffAdd: "#1a7f37",
    diffRemove: "#cf222e",
    code: "#953800",
    codeBg: "#f6f8fa",
    selection: "#c8f2dd",
  },
}

/** Theme files found in any `.jarvis/themes` directory, keyed by filename. */
export function listThemes(cwd = process.cwd()): string[] {
  const names = new Set(Object.keys(THEMES))
  for (const path of resourceFiles(cwd, "themes", ".json")) names.add(basename(path, ".json"))
  return [...names].sort()
}

/**
 * A built-in name, or `<jarvis dir>/themes/<name>.json` overriding any subset of the
 * default tokens. The nearest file wins; an unknown name falls back to the default.
 */
export function loadTheme(name: string, cwd = process.cwd()): Theme {
  const base = THEMES.jarvis!
  const files = resourceFiles(cwd, "themes", ".json").filter((path) => basename(path, ".json") === name)
  const nearest = files[files.length - 1]
  if (nearest) {
    try {
      return { ...base, ...(JSON.parse(readFileSync(nearest, "utf8")) as Partial<Theme>) }
    } catch {
      // a malformed theme file should not stop the UI from starting
    }
  }
  return THEMES[name] ?? base
}
