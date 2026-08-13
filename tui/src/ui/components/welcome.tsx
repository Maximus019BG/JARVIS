import { homedir } from "node:os"
import { useTerminalDimensions } from "@opentui/react"
import { VERSION } from "../../index.tsx"
import { describe, type Keymap } from "../../config/keybinds.ts"
import type { Theme } from "../../config/theme.ts"
import type { Git } from "../git.ts"
import { BRANCH_MARK } from "./status.tsx"

const tilde = (path: string) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path)

/**
 * Orientation for the first screen: where you are, what will answer you, and the four keys
 * worth knowing. Lives inside the scrollbox so it scrolls away instead of needing dismissal.
 */
export function Welcome({
  theme,
  keymap,
  cwd,
  git,
  model,
  agent,
  empty,
  needsProvider,
}: {
  theme: Theme
  keymap: Keymap
  cwd: string
  git?: Git
  model: string
  agent: string
  /** No messages yet, so there is room for the wordmark instead of a version string. */
  empty: boolean
  /** No provider yet, so the one key that fixes that earns a place in a four-key list. */
  needsProvider?: boolean
}) {
  const { width: columns } = useTerminalDimensions()
  // `block` is 66 columns of JARVIS; `tiny` says the same thing in 20 when there is no room.
  const font = columns >= 70 ? "block" : "tiny"
  const keys = [
    ["/", "commands"],
    ["@", "files"],
    // The arrows only switch agents while the buffer is empty, which is exactly the state
    // anyone reading this block is in. `shift+tab` still opens the searchable list.
    ["←→", "agent"],
    [describe(keymap.sessionPicker), "sessions"],
    // Only while it is the thing standing between the reader and a working app. Once a provider
    // exists this row is noise, and a five-key list reads as a menu rather than a hint.
    ...(needsProvider ? [[describe(keymap.providerSetup), "add a provider"]] : []),
  ]

  return (
    // Centred when empty, so the lines under the wordmark stack under its middle rather than
    // hugging the left edge of a centred block.
    <box style={{ flexDirection: "column", width: "100%", paddingTop: 1, alignItems: empty ? "center" : "flex-start" }}>
      {empty ? (
        <box style={{ flexDirection: "column", alignItems: "center", paddingBottom: 1 }}>
          {/* An array of colors is rendered as a gradient, so the wordmark gets one for free. */}
          <ascii-font text="JARVIS" font={font} color={[theme.accent, theme.tool]} />
          <text fg={theme.dim}>{VERSION}</text>
        </box>
      ) : (
        <text fg={theme.accent}>{`jarvis ${VERSION}`}</text>
      )}
      <box style={{ flexDirection: "row" }}>
        <text fg={theme.hint}>{tilde(cwd)}</text>
        {git?.branch && <text fg={theme.dim}>{` ${BRANCH_MARK}`}</text>}
        {git?.branch && <text fg={theme.accent}>{git.branch}</text>}
        {git?.branch && git.dirty && <text fg={theme.warning}>*</text>}
      </box>
      <text fg={theme.muted}>{`${agent}  ${model}`}</text>
      <text fg={theme.hint}>{keys.map(([key, label]) => `${key} ${label}`).join("   ")}</text>
    </box>
  )
}
