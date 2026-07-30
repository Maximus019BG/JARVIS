import type { SelectOption } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useMemo, useState } from "react"
import type { PermissionRequest } from "../../permission.ts"
import type { Theme } from "../../config/theme.ts"

export type Choice = { value: string; label: string; hint?: string }

/**
 * The one list picker, reused for models, agents, sessions and commands. Typing
 * filters; enter picks; escape cancels.
 */
export function Picker({
  title,
  choices,
  theme,
  onPick,
  onCancel,
}: {
  title: string
  choices: Choice[]
  theme: Theme
  onPick: (value: string) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const needle = query.toLowerCase()
    return choices.filter((choice) => `${choice.label} ${choice.hint ?? ""}`.toLowerCase().includes(needle))
  }, [choices, query])

  useKeyboard((key) => {
    if (key.name === "escape") onCancel()
    else if (key.name === "backspace") setQuery((value) => value.slice(0, -1))
    else if (!key.ctrl && !key.meta && key.name?.length === 1) setQuery((value) => value + key.name)
  })

  const options: SelectOption[] = filtered.map((choice) => ({
    name: choice.label,
    description: choice.hint ?? "",
    value: choice.value,
  }))

  return (
    <box
      title={query ? `${title} — ${query}` : title}
      titleColor={theme.accent}
      style={{
        border: true,
        borderColor: theme.border,
        backgroundColor: theme.panel,
        flexDirection: "column",
        height: Math.min(16, filtered.length + 2),
        minHeight: 3,
      }}
    >
      {options.length === 0 ? (
        <text fg={theme.muted}>no matches</text>
      ) : (
        <select
          focused
          options={options}
          showScrollIndicator
          wrapSelection
          backgroundColor={theme.panel}
          textColor={theme.fg}
          descriptionColor={theme.muted}
          selectedBackgroundColor={theme.selection}
          selectedTextColor={theme.fg}
          onSelect={(_, option) => option && onPick(String(option.value))}
          style={{ flexGrow: 1 }}
        />
      )}
    </box>
  )
}

/** The approval prompt. Rendered whenever a tool asks the permission gate. */
export function PermissionPrompt({
  request,
  theme,
  onAnswer,
}: {
  request: PermissionRequest
  theme: Theme
  onAnswer: (answer: "once" | "always" | "reject") => void
}) {
  useKeyboard((key) => {
    if (key.name === "y" || key.name === "return") onAnswer("once")
    else if (key.name === "a") onAnswer("always")
    else if (key.name === "n" || key.name === "escape") onAnswer("reject")
  })

  const detail = request.detail?.split("\n").slice(0, 20) ?? []

  return (
    <box
      title={`${request.tool} wants to run`}
      titleColor={theme.warning}
      style={{
        border: true,
        borderColor: theme.warning,
        backgroundColor: theme.panel,
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={theme.fg}>{request.title}</text>
      {detail.map((line, index) => (
        <text
          key={index}
          fg={line.startsWith("+") ? theme.diffAdd : line.startsWith("-") ? theme.diffRemove : theme.muted}
        >
          {line}
        </text>
      ))}
      <text fg={theme.muted}>
        <span fg={theme.success}>y</span> allow once <span fg={theme.success}>a</span> always allow{" "}
        <span fg={theme.error}>n</span> reject
      </text>
    </box>
  )
}
