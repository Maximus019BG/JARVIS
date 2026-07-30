import { homedir } from "node:os"
import { VERSION } from "../../index.tsx"
import { describe, type Keymap } from "../../config/keybinds.ts"
import type { Theme } from "../../config/theme.ts"

const tilde = (path: string) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path)

/**
 * Orientation for the first screen: where you are, what will answer you, and the four keys
 * worth knowing. Lives inside the scrollbox so it scrolls away instead of needing dismissal.
 */
export function Welcome({
  theme,
  keymap,
  cwd,
  branch,
  model,
  agent,
}: {
  theme: Theme
  keymap: Keymap
  cwd: string
  branch?: string
  model: string
  agent: string
}) {
  const keys = [
    ["/", "commands"],
    ["@", "files"],
    [describe(keymap.agentPicker), "agent"],
    [describe(keymap.sessionPicker), "sessions"],
  ]

  return (
    <box style={{ flexDirection: "column", width: "100%", paddingTop: 1 }}>
      <text fg={theme.accent}>{`jarvis ${VERSION}`}</text>
      <text fg={theme.muted}>{`${tilde(cwd)}${branch ? `  ${branch}` : ""}`}</text>
      <text fg={theme.muted}>{`${agent}  ${model}`}</text>
      <text fg={theme.hint}>{keys.map(([key, label]) => `${key} ${label}`).join("   ")}</text>
    </box>
  )
}
