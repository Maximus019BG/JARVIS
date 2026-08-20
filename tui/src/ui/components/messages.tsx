import type { BoxRenderable, TextRenderable } from "@opentui/core"
import { useRef, useState, type ReactNode } from "react"
import type { Theme } from "../../config/theme.ts"
import { lerpHex, useEnter, useFlash, type MotionLevel } from "../motion.ts"
import { Markdown } from "./markdown.tsx"
import { summarize, type Item } from "../transcript.ts"

/** Preview length for a call that is still running or that failed. */
const OUTPUT_LINES = 8
/** While the model is still thinking, this much of the tail shows as a sign of life. */
const REASONING_LINES = 3
const FLASH_MS = 200
/** Tools whose output is a picture or a report — the answer itself, not a status line. */
const DRAWS = new Set(["blueprint_edit", "blueprint_view", "blueprint_symbol", "blueprint_check"])
/** Lines a drawing keeps: the 22-row braille render plus its caption, with room to spare. */
const DRAWN_LINES = 30

/**
 * How many lines of a tool's output the transcript keeps. A call that worked is normally
 * one line, but collapsing a braille drawing to `✓ blueprint_edit · 25 lines` throws away
 * the thing the user asked for. A long svg or json dump truncates with the same
 * `…N more lines` footer a failure gets.
 */
export const outputBudget = (name: string, done: boolean, failed?: boolean): number =>
  DRAWS.has(name) ? DRAWN_LINES : done && !failed ? 0 : OUTPUT_LINES

/**
 * The thinking lines a reasoning block shows. Folded it shows none — reasoning is not the
 * answer, and a wall of it buries the answer — except while it is still streaming, where
 * the tail is the only sign the model is working.
 */
export const reasoningLines = (text: string, expanded: boolean, live = false): string[] => {
  const lines = text.split("\n").filter((line) => line.trim())
  return expanded ? lines : live ? lines.slice(-REASONING_LINES) : []
}

/** One transcript entry, fading itself in the first time it appears. */
function Entry({ motion, children }: { motion: MotionLevel; children: ReactNode }) {
  const box = useRef<BoxRenderable>(null)
  useEnter(box, motion)
  return (
    <box ref={box} style={{ flexDirection: "column", width: "100%" }}>
      {children}
    </box>
  )
}

function ToolCard({
  item,
  theme,
  motion,
}: {
  item: Extract<Item, { kind: "tool" }>
  theme: Theme
  motion: MotionLevel
}) {
  const glyph = useRef<TextRenderable>(null)
  const done = item.output !== undefined
  const color = item.failed ? theme.error : theme.tool

  // Green or red for a moment as the call lands, then back to the resting color.
  useFlash(done, FLASH_MS, motion, (t) => {
    if (glyph.current) glyph.current.fg = lerpHex(item.failed ? theme.error : theme.success, color, t)
  })

  const lines = item.output?.split("\n") ?? []
  const seconds = item.endedAt ? (item.endedAt - item.startedAt) / 1000 : undefined
  const preview = lines.slice(0, outputBudget(item.name, done, item.failed))
  const hidden = lines.length - preview.length

  const tail = [
    done && !item.failed && lines.length > 1 ? `${lines.length} lines` : undefined,
    seconds !== undefined && seconds >= 0.1 ? `${seconds.toFixed(1)}s` : undefined,
  ].filter(Boolean)

  return (
    <Entry motion={motion}>
      <text ref={glyph} fg={color}>
        <span fg={theme.muted}>{item.agent ? `  ${item.agent} ` : ""}</span>
        {item.output === undefined ? "⋯ " : item.failed ? "✗ " : "✓ "}
        {summarize(item.name, item.input)}
        <span fg={theme.muted}>{tail.length > 0 ? ` · ${tail.join(" · ")}` : ""}</span>
      </text>
      {preview.map((line, index) => (
        <text key={index} fg={theme.muted}>
          {`    ${line}`}
        </text>
      ))}
      {preview.length > 0 && hidden > 0 && <text fg={theme.muted}>{`    …${hidden} more lines`}</text>}
    </Entry>
  )
}

/**
 * One thinking block, folded to its header. Clicking anywhere on it toggles just this one;
 * `toggleReasoning` remounts every block with a new `open`, which toggles them all.
 */
function Reasoning({
  item,
  theme,
  motion,
  open: initial,
  live,
}: {
  item: Extract<Item, { kind: "reasoning" }>
  theme: Theme
  motion: MotionLevel
  open: boolean
  live: boolean
}) {
  const [open, setOpen] = useState(initial)
  const lines = reasoningLines(item.text, open, live)
  const total = item.text.split("\n").filter((line) => line.trim()).length

  return (
    <Entry motion={motion}>
      <box
        onMouseDown={() => setOpen((shown) => !shown)}
        style={{ flexDirection: "column", width: "100%" }}
      >
        <text fg={theme.dim}>{`  ${open ? "▾" : "▸"} thinking${total > 0 ? ` · ${total} lines` : ""}`}</text>
        {lines.map((line, i) => (
          <text key={i} fg={theme.dim}>
            {`  ${line}`}
          </text>
        ))}
      </box>
    </Entry>
  )
}

export function Messages({
  items,
  theme,
  motion,
  streaming,
  thinking,
}: {
  items: Item[]
  theme: Theme
  motion: MotionLevel
  streaming: boolean
  /** Whether thinking blocks start unfolded; flipped by `toggleReasoning`. */
  thinking: boolean
}) {
  return (
    <box style={{ flexDirection: "column", width: "100%", gap: 1 }}>
      {items.map((item, index) => {
        const last = index === items.length - 1
        switch (item.kind) {
          case "user":
            return (
              <Entry key={index} motion={motion}>
                {item.text.split("\n").map((line, i) => (
                  <text key={i} fg={theme.user}>
                    {i === 0 ? `› ${line}` : `  ${line}`}
                  </text>
                ))}
              </Entry>
            )
          case "assistant":
            return (
              <Entry key={index} motion={motion}>
                {item.agent && <text fg={theme.muted}>{`  ${item.agent}`}</text>}
                <Markdown text={item.text} theme={theme} streaming={streaming && last} />
              </Entry>
            )
          case "reasoning":
            return (
              <Reasoning
                key={`${index}:${thinking}`}
                item={item}
                theme={theme}
                motion={motion}
                open={thinking}
                live={streaming && last}
              />
            )
          case "tool":
            return <ToolCard key={item.id} item={item} theme={theme} motion={motion} />
          default:
            return (
              <text key={index} fg={item.level === "error" ? theme.error : theme.muted}>
                {item.text}
              </text>
            )
        }
      })}
    </box>
  )
}
