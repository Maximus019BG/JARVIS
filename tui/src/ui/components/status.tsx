import { basename } from "node:path"
import type { TextRenderable } from "@opentui/core"
import { useRef } from "react"
import type { Usage } from "../../agent/agent.ts"
import type { Theme } from "../../config/theme.ts"
import type { Git } from "../git.ts"
import { useOscillator, type MotionLevel } from "../motion.ts"

/** One breath of the busy dot. Slower than the spinner so the two do not compete. */
const PULSE_MS = 1200

/** The branch mark. Quiet enough to read as punctuation, distinct enough to not read as path. */
export const BRANCH_MARK = " ⑂ "

const thousands = (n: number) => `${(n / 1000).toFixed(1)}k`

/** A run of status text and the theme token it is drawn in. */
export type Part = { text: string; tone: "muted" | "dim" | "accent" | "warning" }

const gap: Part = { text: "  ", tone: "muted" }

/**
 * Splits the status line into the model (always shown) and the extras, dropping extras
 * from the left as the terminal narrows. The key hint is never dropped: losing the one
 * line that says how to find anything is the opposite of what a narrow terminal needs.
 *
 * The extras come back as colored runs rather than one joined string: a flat line of muted
 * text gives the reader no way to tell a branch from a directory from a dollar amount.
 */
export function segments(options: {
  model: string
  cwd: string
  git?: Git
  usage: Usage
  contextLimit?: number
  /** Prompt tokens on the last turn — the honest measure of how full the window is. */
  contextTokens?: number
  width: number
}): { left: string; right: Part[] } {
  const { model, cwd, git, usage, contextLimit, contextTokens = 0, width } = options
  const tokens = usage.input + usage.output

  const plain = (text: string | undefined): Part[] | undefined => (text ? [{ text, tone: "muted" }] : undefined)

  // Directory and branch are one group, so a narrowing terminal can never leave a bare
  // branch name standing next to nothing that says where it is.
  const location: Part[] = [{ text: basename(cwd), tone: "muted" }]
  if (git?.branch) {
    location.push({ text: BRANCH_MARK, tone: "dim" }, { text: git.branch, tone: "accent" })
    if (git.dirty) location.push({ text: "*", tone: "warning" })
  }

  const optional = [
    plain(usage.cost > 0 ? `$${usage.cost.toFixed(4)}` : undefined),
    location,
    // Session totals are the wrong numerator here: they count the same history once per
    // step, so a long turn would read as 300% of a window it never filled.
    plain(
      contextLimit && contextTokens > 0
        ? `${thousands(contextTokens)}/${thousands(contextLimit)} ${Math.round((contextTokens / contextLimit) * 100)}%`
        : tokens > 0
          ? `${thousands(tokens)} tokens`
          : undefined,
    ),
  ].filter((group): group is Part[] => Boolean(group))

  // Whatever the agent name, the model and the key hint leave behind.
  const budget = Math.max(0, width - model.length - 28)
  const kept: Part[][] = []
  let used = 0
  for (const group of optional.reverse()) {
    const width = group.reduce((total, part) => total + part.text.length, 0)
    const length = used === 0 ? width : used + gap.text.length + width
    if (length > budget) break
    kept.unshift(group)
    used = length
  }
  return { left: model, right: kept.flatMap((group, index) => (index === 0 ? group : [gap, ...group])) }
}

export function Status({
  theme,
  motion,
  cwd,
  git,
  model,
  agent,
  usage,
  contextLimit,
  contextTokens,
  vim,
  busy,
  width,
  hint,
}: {
  theme: Theme
  motion: MotionLevel
  cwd: string
  git?: Git
  model: string
  agent: string
  usage: Usage
  contextLimit?: number
  contextTokens?: number
  /** Vim mode, when vim mode is on at all. */
  vim?: "normal" | "insert"
  busy: boolean
  width: number
  hint: string
}) {
  const dot = useRef<TextRenderable>(null)
  useOscillator(busy, PULSE_MS, motion, (t) => {
    if (dot.current) dot.current.opacity = 0.45 + 0.55 * t
  })

  const { left, right } = segments({ model, cwd, git, usage, contextLimit, contextTokens, width })

  return (
    <box style={{ flexDirection: "row", width: "100%", backgroundColor: theme.panel, paddingLeft: 1, paddingRight: 1 }}>
      <text ref={dot} fg={busy ? theme.warning : theme.muted}>
        {busy ? "● " : "○ "}
      </text>
      {vim && <text fg={vim === "insert" ? theme.success : theme.accent}>{`${vim === "insert" ? "INS" : "NOR"} `}</text>}
      <text fg={theme.accent}>{agent}</text>
      <text fg={theme.muted}>{`  ${left}`}</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.hint}>{hint ? `${hint}  ` : ""}</text>
      {right.map((part, index) => (
        <text key={index} fg={theme[part.tone]}>
          {part.text}
        </text>
      ))}
    </box>
  )
}
