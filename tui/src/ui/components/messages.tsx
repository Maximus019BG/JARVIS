import type { BoxRenderable, TextRenderable } from "@opentui/core"
import { useRef, type ReactNode } from "react"
import type { Theme } from "../../config/theme.ts"
import { lerpHex, useEnter, useFlash, type MotionLevel } from "../motion.ts"
import { Markdown } from "./markdown.tsx"
import { summarize, type Item } from "../transcript.ts"

/** Preview length for a call that is still running or that failed. */
const OUTPUT_LINES = 8
/** Reasoning is skimmable context, not the answer; only its tail stays on screen. */
const REASONING_LINES = 3
const FLASH_MS = 200

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
  // A call that worked is one line; only failures and work in flight earn the space.
  const preview = done && !item.failed ? [] : lines.slice(0, OUTPUT_LINES)
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

export function Messages({
  items,
  theme,
  motion,
  streaming,
}: {
  items: Item[]
  theme: Theme
  motion: MotionLevel
  streaming: boolean
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
          case "reasoning": {
            const lines = item.text.split("\n").filter((line) => line.trim())
            return (
              <Entry key={index} motion={motion}>
                {lines.slice(-REASONING_LINES).map((line, i) => (
                  <text key={i} fg={theme.dim}>
                    {`  ${line}`}
                  </text>
                ))}
              </Entry>
            )
          }
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
