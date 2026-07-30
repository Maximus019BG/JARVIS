import type { Theme } from "../theme.ts"
import { Markdown } from "./markdown.tsx"
import { summarize, type Item } from "./transcript.ts"

const OUTPUT_LINES = 8

function ToolCard({ item, theme }: { item: Extract<Item, { kind: "tool" }>; theme: Theme }) {
  const lines = item.output?.split("\n") ?? []
  const shown = lines.slice(0, OUTPUT_LINES)
  const hidden = lines.length - shown.length
  const color = item.failed ? theme.error : theme.tool

  return (
    <box style={{ flexDirection: "column", width: "100%" }}>
      <text fg={color}>
        <span fg={theme.muted}>{item.agent ? `  ${item.agent} ` : ""}</span>
        {item.output === undefined ? "⋯ " : item.failed ? "✗ " : "✓ "}
        {summarize(item.name, item.input)}
      </text>
      {shown.map((line, index) => (
        <text key={index} fg={theme.muted}>
          {`    ${line}`}
        </text>
      ))}
      {hidden > 0 && <text fg={theme.muted}>{`    …${hidden} more lines`}</text>}
    </box>
  )
}

export function Messages({ items, theme, streaming }: { items: Item[]; theme: Theme; streaming: boolean }) {
  return (
    <box style={{ flexDirection: "column", width: "100%", gap: 1 }}>
      {items.map((item, index) => {
        const last = index === items.length - 1
        switch (item.kind) {
          case "user":
            return (
              <box key={index} style={{ flexDirection: "column", width: "100%" }}>
                {item.text.split("\n").map((line, i) => (
                  <text key={i} fg={theme.user}>
                    {i === 0 ? `› ${line}` : `  ${line}`}
                  </text>
                ))}
              </box>
            )
          case "assistant":
            return (
              <box key={index} style={{ flexDirection: "column", width: "100%" }}>
                {item.agent && <text fg={theme.muted}>{`  ${item.agent}`}</text>}
                <Markdown text={item.text} theme={theme} streaming={streaming && last} />
              </box>
            )
          case "tool":
            return <ToolCard key={item.id} item={item} theme={theme} />
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
