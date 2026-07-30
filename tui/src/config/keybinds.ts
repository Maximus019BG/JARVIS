export type Action =
  | "submit"
  | "newline"
  | "interrupt"
  | "exit"
  | "clear"
  | "palette"
  | "modelPicker"
  | "agentPicker"
  | "sessionPicker"
  | "filePicker"
  | "newSession"
  | "scrollUp"
  | "scrollDown"
  | "scrollHalfUp"
  | "scrollHalfDown"
  | "scrollBottom"
  /** Takes the highlighted `/` or `@` completion; inert when the strip is closed. */
  | "acceptSuggestion"

export const DEFAULT_KEYBINDS: Record<Action, string> = {
  submit: "return",
  newline: "shift+return",
  interrupt: "escape",
  exit: "ctrl+c",
  clear: "ctrl+l",
  palette: "ctrl+p",
  modelPicker: "ctrl+o",
  // `tab` completes, like everywhere else in a terminal; the agent picker is the rarer
  // action, so it takes the modifier.
  agentPicker: "shift+tab",
  sessionPicker: "ctrl+r",
  filePicker: "ctrl+t",
  newSession: "ctrl+n",
  scrollUp: "pageup",
  scrollDown: "pagedown",
  scrollHalfUp: "ctrl+u",
  scrollHalfDown: "ctrl+d",
  scrollBottom: "end",
  acceptSuggestion: "tab",
}

export type Chord = { name: string; ctrl: boolean; shift: boolean; meta: boolean }

/** Parses `"ctrl+shift+return"` into the shape opentui key events use. */
export function parseChord(binding: string): Chord {
  const parts = binding.toLowerCase().split("+")
  const name = parts.pop() ?? ""
  return {
    name,
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    meta: parts.includes("meta") || parts.includes("alt") || parts.includes("option"),
  }
}

export type Keymap = Record<Action, Chord>

export function loadKeymap(overrides: Record<string, string>): Keymap {
  const merged = { ...DEFAULT_KEYBINDS, ...overrides } as Record<Action, string>
  return Object.fromEntries(Object.entries(merged).map(([action, binding]) => [action, parseChord(binding)])) as Keymap
}

type KeyLike = { name?: string; ctrl?: boolean; shift?: boolean; meta?: boolean; option?: boolean }

export function matches(key: KeyLike, chord: Chord): boolean {
  return (
    key.name === chord.name &&
    Boolean(key.ctrl) === chord.ctrl &&
    Boolean(key.shift) === chord.shift &&
    Boolean(key.meta ?? key.option) === chord.meta
  )
}

/** Human-readable form for the status line and the help dialog. */
export function describe(chord: Chord): string {
  const parts: string[] = []
  if (chord.ctrl) parts.push("ctrl")
  if (chord.meta) parts.push("alt")
  if (chord.shift) parts.push("shift")
  parts.push(chord.name === "return" ? "enter" : chord.name)
  return parts.join("+")
}
