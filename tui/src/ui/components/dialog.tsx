import type { BoxRenderable, ScrollBoxRenderable, SelectOption } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useMemo, useRef, useState, type ReactNode } from "react"
import type { PermissionRequest } from "../../permission.ts"
import type { Theme } from "../../config/theme.ts"
import { useEnter, type MotionLevel } from "../motion.ts"

export type Choice = { value: string; label: string; hint?: string }

/**
 * Floats its child over the whole app rather than taking a slot at the bottom. No
 * backdrop: a terminal has no alpha, so a filled one would blank the transcript instead of
 * dimming it — the child's own border and panel background are what read as "on top".
 */
function Modal({ children }: { children: ReactNode }) {
  return (
    <box
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 100,
      }}
    >
      {children}
    </box>
  )
}

/**
 * The one list picker, reused for models, agents, sessions and commands. Typing
 * filters; enter picks; escape cancels. Presented as a centered modal, so choosing a model
 * does not shove the prompt you were writing off the screen.
 */
export function Picker({
  title,
  choices,
  theme,
  motion,
  onPick,
  onCancel,
}: {
  title: string
  choices: Choice[]
  theme: Theme
  motion: MotionLevel
  onPick: (value: string) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState("")
  const box = useRef<BoxRenderable>(null)
  const filtered = useMemo(() => {
    const needle = query.toLowerCase()
    return choices.filter((choice) => `${choice.label} ${choice.hint ?? ""}`.toLowerCase().includes(needle))
  }, [choices, query])

  useKeyboard((key) => {
    if (key.name === "escape") onCancel()
    else if (key.name === "backspace") setQuery((value) => value.slice(0, -1))
    // opentui names the space bar "space", so it needs its own case or multi-word
    // queries are impossible.
    else if (key.name === "space") setQuery((value) => `${value} `)
    else if (!key.ctrl && !key.meta && key.name?.length === 1) setQuery((value) => value + key.name)
  })

  const options: SelectOption[] = filtered.map((choice) => ({
    name: choice.label,
    description: choice.hint ?? "",
    value: choice.value,
  }))

  const { width: columns, height: rows } = useTerminalDimensions()
  // A choice with a hint renders as two lines, name over description. Counting one line
  // each would show half the list and hide the rest behind a scrollbar for no reason.
  const perRow = filtered.some((choice) => choice.hint) ? 2 : 1
  const height = Math.max(3, Math.min(filtered.length * perRow + 2, Math.floor(rows * 0.7)))
  const width = Math.max(28, Math.min(76, columns - 8))
  useEnter(box, motion, { ms: 140, height })

  return (
    <Modal>
      <box
        ref={box}
        title={query ? `${title} — ${query}` : title}
        titleColor={theme.accent}
        bottomTitle={`↑↓ move · enter select · esc cancel · ${filtered.length}/${choices.length}`}
        style={{
          border: true,
          borderColor: theme.accent,
          backgroundColor: theme.panel,
          flexDirection: "column",
          height,
          width,
          minHeight: 3,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        {options.length === 0 ? (
          <text fg={theme.muted}>no matches — esc to cancel</text>
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
    </Modal>
  )
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** Preamble lines of a unified patch, which the diff view does not render. */
const PATCH_HEADER = /^(Index: |={10,}$|--- |\+\+\+ |@@ )/

/**
 * The approval prompt. Rendered whenever a tool asks the permission gate. The detail
 * scrolls rather than truncating: approving a diff you were not shown is the one failure
 * this dialog must not have.
 */
export function PermissionPrompt({
  request,
  theme,
  motion,
  onAnswer,
}: {
  request: PermissionRequest
  theme: Theme
  motion: MotionLevel
  onAnswer: (answer: "once" | "always" | "reject") => void
}) {
  const { height: rows } = useTerminalDimensions()
  const body = useRef<ScrollBoxRenderable>(null)
  const box = useRef<BoxRenderable>(null)

  useKeyboard((key) => {
    if (key.name === "y" || key.name === "return") onAnswer("once")
    else if (key.name === "a") onAnswer("always")
    else if (key.name === "n" || key.name === "escape") onAnswer("reject")
    else if (key.name === "u" && key.ctrl) body.current?.scrollBy({ x: 0, y: -8 })
    else if (key.name === "d" && key.ctrl) body.current?.scrollBy({ x: 0, y: 8 })
  })

  useEnter(box, motion, { ms: 140 })

  const all = request.detail?.split("\n") ?? []
  // The diff view drops the patch preamble, so sizing on the raw line count would leave a
  // block of empty rows under the change.
  const lines = request.detailKind === "diff" ? all.filter((line) => !PATCH_HEADER.test(line)) : all
  // Half the screen at most, so the transcript stays visible behind the prompt. The box
  // is sized explicitly: the answer line has to survive, whatever the detail does.
  const visible = Math.max(3, Math.min(lines.length, Math.floor(rows / 2)))
  const grant = request.subject ? `${request.tool} ${clip(request.subject, 40)}` : request.tool

  return (
    <box
      ref={box}
      title={`approve: ${request.title}`}
      titleColor={theme.warning}
      bottomTitle={lines.length > visible ? `${lines.length} lines · ctrl+u/d scroll` : undefined}
      style={{
        border: true,
        borderColor: theme.warning,
        backgroundColor: theme.panel,
        flexDirection: "column",
        height: visible + 3,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <scrollbox
        ref={body}
        style={{
          flexGrow: 1,
          rootOptions: { backgroundColor: theme.panel },
          viewportOptions: { backgroundColor: theme.panel },
          contentOptions: { backgroundColor: theme.panel },
          scrollbarOptions: { trackOptions: { foregroundColor: theme.border, backgroundColor: theme.panel } },
        }}
      >
        {request.detailKind === "diff" ? (
          <diff diff={request.detail ?? ""} fg={theme.fg} style={{ width: "100%" }} />
        ) : (
          lines.map((line, index) => (
            <text key={index} fg={theme.muted}>
              {line}
            </text>
          ))
        )}
      </scrollbox>
      <text fg={theme.muted} style={{ flexShrink: 0 }}>
        <span fg={theme.success}>y</span> allow once <span fg={theme.success}>a</span> always allow{" "}
        <span fg={theme.hint}>{grant}</span> <span fg={theme.error}>n</span> reject
      </text>
    </box>
  )
}
