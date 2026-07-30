import { basename } from "node:path"
import type { TextRenderable } from "@opentui/core"
import { useRef } from "react"
import type { Usage } from "../../agent/agent.ts"
import type { Theme } from "../../config/theme.ts"
import { useOscillator, type MotionLevel } from "../motion.ts"

/** One breath of the busy dot. Slower than the spinner so the two do not compete. */
const PULSE_MS = 1200

const thousands = (n: number) => `${(n / 1000).toFixed(1)}k`

/**
 * Splits the status line into the model (always shown) and the extras, dropping extras
 * from the left as the terminal narrows. The key hint is never dropped: losing the one
 * line that says how to find anything is the opposite of what a narrow terminal needs.
 */
export function segments(options: {
  model: string
  cwd: string
  branch?: string
  usage: Usage
  contextLimit?: number
  width: number
}): { left: string; right: string } {
  const { model, cwd, branch, usage, contextLimit, width } = options
  const tokens = usage.input + usage.output

  const optional = [
    usage.cost > 0 ? `$${usage.cost.toFixed(4)}` : undefined,
    branch,
    basename(cwd),
    tokens > 0 && contextLimit
      ? `${thousands(tokens)}/${thousands(contextLimit)} ${Math.round((tokens / contextLimit) * 100)}%`
      : tokens > 0
        ? `${thousands(tokens)} tokens`
        : undefined,
  ].filter((part): part is string => Boolean(part))

  // Whatever the agent name, the model and the key hint leave behind.
  const budget = Math.max(0, width - model.length - 28)
  const kept: string[] = []
  let used = 0
  for (const part of optional.reverse()) {
    const length = used === 0 ? part.length : used + 2 + part.length
    if (length > budget) break
    kept.unshift(part)
    used = length
  }
  return { left: model, right: kept.join("  ") }
}

export function Status({
  theme,
  motion,
  cwd,
  branch,
  model,
  agent,
  usage,
  contextLimit,
  busy,
  width,
  hint,
}: {
  theme: Theme
  motion: MotionLevel
  cwd: string
  branch?: string
  model: string
  agent: string
  usage: Usage
  contextLimit?: number
  busy: boolean
  width: number
  hint: string
}) {
  const dot = useRef<TextRenderable>(null)
  useOscillator(busy, PULSE_MS, motion, (t) => {
    if (dot.current) dot.current.opacity = 0.45 + 0.55 * t
  })

  const { left, right } = segments({ model, cwd, branch, usage, contextLimit, width })

  return (
    <box style={{ flexDirection: "row", width: "100%", backgroundColor: theme.panel, paddingLeft: 1, paddingRight: 1 }}>
      <text ref={dot} fg={busy ? theme.warning : theme.muted}>
        {busy ? "● " : "○ "}
      </text>
      <text fg={theme.accent}>{agent}</text>
      <text fg={theme.muted}>{`  ${left}`}</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.hint}>{hint ? `${hint}  ` : ""}</text>
      <text fg={theme.muted}>{right}</text>
    </box>
  )
}
