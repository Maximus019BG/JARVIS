import { basename } from "node:path"
import type { Usage } from "../agent.ts"
import type { Theme } from "../theme.ts"

export function Status({
  theme,
  cwd,
  model,
  agent,
  usage,
  busy,
  hint,
}: {
  theme: Theme
  cwd: string
  model: string
  agent: string
  usage: Usage
  busy: boolean
  hint?: string
}) {
  const tokens = usage.input + usage.output
  const right = [
    tokens > 0 ? `${(tokens / 1000).toFixed(1)}k tokens` : undefined,
    usage.cost > 0 ? `$${usage.cost.toFixed(4)}` : undefined,
  ]
    .filter(Boolean)
    .join("  ")

  return (
    <box style={{ flexDirection: "row", width: "100%", backgroundColor: theme.panel, paddingLeft: 1, paddingRight: 1 }}>
      <text fg={busy ? theme.warning : theme.muted}>{busy ? "● " : "○ "}</text>
      <text fg={theme.accent}>{agent}</text>
      <text fg={theme.muted}>{`  ${model}  ${basename(cwd)}`}</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.muted}>{hint ? `${hint}  ` : ""}</text>
      <text fg={theme.muted}>{right}</text>
    </box>
  )
}
