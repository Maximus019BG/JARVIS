import type { BoxRenderable, ScrollBoxRenderable, SelectOption, SelectRenderable } from "@opentui/core"
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
export function Modal({ children }: { children: ReactNode }) {
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

/** The `Other…` entry's value. A control character, so no real choice can collide with it. */
const OTHER = "\u0000other"

/**
 * Greedy word wrap. A word wider than the box is broken rather than left to overflow, which
 * a terminal renders as a silently clipped line.
 */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ""
  const flush = () => {
    if (line) lines.push(line)
    line = ""
  }
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      flush()
      lines.push(word.slice(0, width))
      word = word.slice(width)
    }
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      flush()
      line = word
    }
  }
  flush()
  return lines
}

/**
 * The one list picker, reused for models, agents, sessions, commands and the `ask` tool's
 * question. Typing filters; enter picks; escape cancels. Presented as a centered modal, so
 * choosing a model does not shove the prompt you were writing off the screen.
 */
export function Picker({
  title,
  prompt,
  choices,
  theme,
  motion,
  allowOther,
  onPick,
  onDelete,
  onCancel,
}: {
  title: string
  /** Body text above the list, wrapped. For a question, whose sentence a title would clip. */
  prompt?: string
  choices: Choice[]
  theme: Theme
  motion: MotionLevel
  /** Adds an `Other…` entry that opens a one-line field, so the answer is not list-bound. */
  allowOther?: boolean
  onPick: (value: string) => void
  /** When given, `shift+D` removes the highlighted entry after a confirmation. */
  onDelete?: (value: string) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState("")
  /** The entry `shift+D` is asking about. Nothing is removed until `y`. */
  const [pending, setPending] = useState<Choice | null>(null)
  /** The free-text answer, once `Other…` has been chosen. Null means the list is up. */
  const [other, setOther] = useState<string | null>(null)
  const box = useRef<BoxRenderable>(null)
  // Read at press time rather than mirrored into state: the select owns the highlight, and
  // a copy would only be a second thing that can be wrong.
  const list = useRef<SelectRenderable>(null)
  const filtered = useMemo(() => {
    const needle = query.toLowerCase()
    return choices.filter((choice) => `${choice.label} ${choice.hint ?? ""}`.toLowerCase().includes(needle))
  }, [choices, query])

  useKeyboard((key) => {
    // The field owns every key while it is open — otherwise each letter would land in the
    // filter as well as in the input. Escape backs out to the list rather than closing the
    // dialog: a half-typed answer is not a dismissal.
    if (other !== null) {
      if (key.name === "escape") setOther(null)
      // Enter is claimed here rather than through the `<input>`'s own onSubmit, which the
      // OpenTUI intrinsics type as both a value and a form-event handler.
      else if (key.name === "return" || key.name === "enter") {
        const answer = other.trim()
        // Empty is the `ask` tool's dismissal sentinel, so it must never be sent as an answer.
        if (answer) onPick(answer)
        return key.stopPropagation()
      }
      return
    }
    // The confirmation owns every key while it is up, so a stray letter cannot both answer
    // it and land in the filter. Only `y` deletes; anything else backs out.
    if (pending) {
      if (key.name === "y") onDelete?.(pending.value)
      setPending(null)
      return
    }
    // Before the filter, or shift+D would just type a `d` into the query. Case-insensitive
    // filtering means stealing the capital costs the user nothing.
    if (onDelete && key.name === "d" && key.shift && !key.ctrl && !key.meta) {
      // `selectedIndex` is a setter with no getter, so it reads back undefined — the
      // method is the only way to ask the select where the highlight actually is.
      const target = filtered[list.current?.getSelectedIndex() ?? 0]
      if (target) setPending(target)
      return
    }
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
  // Appended after the filter rather than through it: the way out of a list that does not
  // contain your answer must not be something the query can hide.
  if (allowOther) options.push({ name: "Other…", description: "type your own answer", value: OTHER })

  const { width: columns, height: rows } = useTerminalDimensions()
  const width = Math.max(28, Math.min(76, columns - 8))
  // The border and its one column of padding on each side eat four columns.
  const lines = prompt ? wrapText(prompt, width - 4) : []
  // A choice with a hint renders as two lines, name over description. Counting one line
  // each would show half the list and hide the rest behind a scrollbar for no reason.
  const perRow = filtered.some((choice) => choice.hint) ? 2 : 1
  const body = other !== null ? 1 : Math.min(options.length * perRow, Math.floor(rows * 0.7))
  const height = Math.max(3, Math.min(body + lines.length + 2, Math.floor(rows * 0.9)))
  useEnter(box, motion, { ms: 140, height })

  return (
    <Modal>
      <box
        ref={box}
        title={
          pending ? `delete "${clip(pending.label, 30)}"?` : query && other === null ? `${title} — ${query}` : title
        }
        titleColor={pending ? theme.error : theme.accent}
        // A bottom title wider than the box is dropped silently rather than clipped, so the
        // keys have to be kept short enough to survive — losing the one line that says
        // `shift+D` deletes is how a destructive key becomes a surprise.
        bottomTitle={clip(
          pending
            ? "y delete · any other key keeps it"
            : other !== null
              ? "enter send · esc back"
              : `↑↓ enter${onDelete ? " · shift+D del" : ""} · esc · ${filtered.length}/${choices.length}`,
          width - 4,
        )}
        style={{
          border: true,
          borderStyle: "rounded",
          borderColor: pending ? theme.error : theme.accent,
          backgroundColor: theme.panel,
          flexDirection: "column",
          height,
          width,
          minHeight: 3,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        {lines.map((line, index) => (
          <text key={index} fg={theme.fg} style={{ flexShrink: 0 }}>
            {line}
          </text>
        ))}
        {other !== null ? (
          <input
            focused
            value={other}
            placeholder="your answer"
            backgroundColor={theme.panel}
            textColor={theme.fg}
            placeholderColor={theme.muted}
            cursorColor={theme.accent}
            onInput={setOther}
          />
        ) : options.length === 0 ? (
          <text fg={theme.muted}>no matches — esc to cancel</text>
        ) : (
          <select
            ref={list}
            focused
            options={options}
            // Off unless something actually has a description to show: the renderable spends
            // two lines an entry whenever it is on, empty description or not, while the height
            // above counts one — which is how a three-option question rendered as one option.
            showDescription={perRow === 2}
            showScrollIndicator
            wrapSelection
            backgroundColor={theme.panel}
            textColor={theme.fg}
            descriptionColor={theme.muted}
            selectedBackgroundColor={theme.selection}
            selectedTextColor={theme.fg}
            onSelect={(_, option) => {
              if (!option) return
              const value = String(option.value)
              if (value === OTHER) setOther("")
              else onPick(value)
            }}
            style={{ flexGrow: 1 }}
          />
        )}
      </box>
    </Modal>
  )
}

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** Preamble lines of a unified patch, which the diff view does not render. */
export const PATCH_HEADER = /^(Index: |={10,}$|--- |\+\+\+ |@@ )/

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
        borderStyle: "rounded",
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
