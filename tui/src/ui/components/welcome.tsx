import { homedir } from "node:os"
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
}: {
  theme: Theme
  keymap: Keymap
  cwd: string
  git?: Git
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
