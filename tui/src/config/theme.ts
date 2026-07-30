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
  jarvis: {
    bg: "#0e1116",
    panel: "#161b22",
    fg: "#c9d1d9",
    muted: "#6e7681",
    border: "#30363d",
    accent: "#58a6ff",
    user: "#7ee787",
    assistant: "#c9d1d9",
    tool: "#a5a5ff",
    success: "#3fb950",
    error: "#f85149",
    warning: "#d29922",
    diffAdd: "#3fb950",
    diffRemove: "#f85149",
    code: "#ffa657",
    codeBg: "#1c2128",
    selection: "#1f6feb",
  },
  light: {
    bg: "#ffffff",
    panel: "#f6f8fa",
    fg: "#24292f",
    muted: "#6e7781",
    border: "#d0d7de",
    accent: "#0969da",
    user: "#1a7f37",
    assistant: "#24292f",
    tool: "#6639ba",
    success: "#1a7f37",
    error: "#cf222e",
    warning: "#9a6700",
    diffAdd: "#1a7f37",
    diffRemove: "#cf222e",
    code: "#953800",
    codeBg: "#f6f8fa",
    selection: "#ddf4ff",
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
