import { describe, type Keymap } from "../config/keybinds.ts"
import type { Line, PanelContent } from "./components/panel.tsx"

/**
 * Where things are on screen. The point of a picture rather than a list is that every label
 * names something the reader can then go and find — a key table alone tells you what exists
 * but not where to look for it.
 */
const MAP = [
  "  ┌──────────────────────────────────┐",
  "  │                                  │  your messages, replies",
  "  │  transcript                      │  and tool cards",
  "  │                                  │",
  "  │  /export  Write the session…     │  completions, on / or @",
  "  │                                  │",
  "  │ │ ask jarvis, or / for commands  │  the input — its left rail",
  "  │                                  │  breathes while a turn runs",
  "  │   tab or enter complete · esc    │  what the keys do right now",
  "  │                        ╭───────╮ │",
  "  │                        │ ✗ …   │ │  toasts: errors, so none",
  "  │                        ╰───────╯ │  scrolls past unseen",
  "  │ ● jarvis opus-5  JARVIS ⑂ main*  │  status: agent, model, cost,",
  "  └──────────────────────────────────┘  context %, branch (* dirty)",
]

/** The widest schematic line, so it is only shown when it will not be wrapped into soup. */
const MAP_WIDTH = Math.max(...MAP.map((line) => [...line].length))

/**
 * Keys that are not in the keymap because half the binding is the state of the buffer — they
 * only act when there is nothing to move a cursor through. Listing them is the only way
 * anyone finds them.
 */
const CONTEXTUAL: [string, string][] = [
  ["←  →", "previous / next agent — empty input only"],
  ["tab", "next model — empty input only"],
  ["↑  ↓", "previous / next prompt — at the first or last line"],
  ["shift+D", "delete the highlighted session, in /sessions"],
  ["!cmd", "run a shell command"],
  ["@path", "insert a file path"],
]

const WORTH_KNOWING: [string, string][] = [
  ["/pair", "link this machine to the web app — unlocks JARVIS (hosted), no key needed"],
  ["/provider", "add a provider, step by step — a key is all it takes"],
  ["/provider test <id>", "a real request, so a bad key fails here and not mid-turn"],
  ["/provider stats", "per-day usage, failures and observed outages"],
  ["/undo", "revert the file changes from the last turn"],
  ["/compact", "summarize the history when the context % climbs"],
  ["/export", "write the whole session to markdown"],
  ["jarvis.jsonc", "agents, permissions, keybinds, mcp servers"],
]

/**
 * The tutorial as panel content. Keys come from the live keymap rather than being restated,
 * so a rebind cannot leave this screen lying about which key does what.
 */
export function tutorialContent(keymap: Keymap, keys: [keyof Keymap, string][], width: number): PanelContent {
  const pad = Math.max(
    ...keys.map(([action]) => describe(keymap[action]).length),
    ...CONTEXTUAL.map(([key]) => key.length),
    ...WORTH_KNOWING.map(([name]) => name.length),
  )
  const rows = (entries: [string, string][]): Line[] =>
    entries.map(([key, label]) => ({ text: `  ${key.padEnd(pad)}  ${label}` }))

  return {
    title: "tutorial",
    lines: [
      { text: "Everything on screen, and where to find it.", tone: "fg" },
      { text: "" },
      // A wrapped diagram is worse than no diagram, so drop it rather than scramble it.
      ...(width >= MAP_WIDTH ? MAP.map((text) => ({ text })) : []),
      { text: "" },
      { text: "keys", tone: "accent" },
      ...rows(keys.map(([action, label]) => [describe(keymap[action]), label])),
      { text: "" },
      { text: "these depend on what is in the input", tone: "accent" },
      ...rows(CONTEXTUAL),
      { text: "" },
      { text: "worth knowing", tone: "accent" },
      ...rows(WORTH_KNOWING),
    ],
  }
}
