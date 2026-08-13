import type { BoxRenderable, PasteEvent, SelectOption, SelectRenderable } from "@opentui/core"
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import type { Theme } from "../../config/theme.ts"
import type { TestOutcome } from "../../agent/provider-test.ts"
import { useEnter, useOscillator, type MotionLevel } from "../motion.ts"
import { summarize, type Setup, type SetupCtx, type StepSpec } from "../provider-setup.ts"
import { clip, Modal, type Choice } from "./dialog.tsx"

/** Bracketed paste carries bytes; older builds also expose the decoded text. */
const pasteText = (event: PasteEvent): string => {
  const maybe = (event as PasteEvent & { text?: string }).text
  return typeof maybe === "string" ? maybe : new TextDecoder().decode(event.bytes)
}

/**
 * A masked single-line field.
 *
 * Hand-rolled rather than `<input>` with a flag, because OpenTUI has no conceal option — an
 * `<input>` here would render the key in the clear, which is exactly what a shoulder or a
 * screenshot must not get. Keys are captured into local state and only ever rendered as bullets.
 *
 * `usePaste` is not optional: pasting is how an API key is normally entered, and the
 * single-character key capture below cannot see a bracketed paste at all.
 */
export function SecretField({
  value,
  theme,
  onChange,
  onSubmit,
}: {
  value: string
  theme: Theme
  onChange: (value: string) => void
  onSubmit: (value: string) => void
}) {
  // Mirrored so a keystroke does not have to wait for the parent's commit to show up.
  const held = useRef(value)
  held.current = value

  usePaste((event) => {
    // Newlines out: a key copied from a web page often brings one, and it would submit the
    // field halfway through the paste.
    const pasted = pasteText(event).replace(/[\r\n]+/g, "")
    if (!pasted) return
    onChange(held.current + pasted)
  })

  useKeyboard((key) => {
    if (key.name === "return" || key.name === "enter") return onSubmit(held.current)
    if (key.name === "backspace") return onChange(held.current.slice(0, -1))
    // opentui names the space bar "space"; without this a key containing one is unenterable.
    if (key.name === "space") return onChange(`${held.current} `)
    if (!key.ctrl && !key.meta && key.name?.length === 1) onChange(held.current + key.name)
  })

  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={theme.fg}>{value.length > 0 ? "•".repeat(Math.min(value.length, 48)) : ""}</text>
      <text fg={theme.accent}>█</text>
      <text fg={theme.muted}>{value.length > 0 ? `  ${value.length} chars` : "  paste or type"}</text>
    </box>
  )
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** Choices offered once a test has settled, so a failure is correctable rather than terminal. */
export const RESULT_CHOICES = (ok: boolean): Choice[] =>
  ok
    ? [{ value: "save", label: "Save it", hint: "writes the provider and selects the model" }]
    : [
        { value: "retry", label: "Try again", hint: "same settings" },
        { value: "key", label: "Change the key", hint: "back to the key step" },
        { value: "save", label: "Save anyway", hint: "keep it and fix it later" },
        { value: "cancel", label: "Discard", hint: "nothing is written" },
      ]

export type TestState = { running: boolean; installing?: boolean; outcome?: TestOutcome }

/**
 * The provider setup overlay. Presentational: every decision about what to ask and whether an
 * answer is acceptable belongs to the reducer in provider-setup.ts, so this renders a `StepSpec`
 * and reports back what the reader did.
 */
export function Wizard({
  setup,
  spec,
  theme,
  motion,
  models,
  result,
  onSubmit,
  onToggle,
  onSwitchKeyMode,
  onBack,
  onCancel,
}: {
  setup: Setup
  spec: StepSpec
  ctx?: SetupCtx
  theme: Theme
  motion: MotionLevel
  /** Populated asynchronously while the models step is open. */
  models?: { loading: boolean; note?: string }
  result?: TestState
  onSubmit: (value: string) => void
  onToggle: (value: string) => void
  onSwitchKeyMode: () => void
  onBack: () => void
  onCancel: () => void
}) {
  const box = useRef<BoxRenderable>(null)
  const list = useRef<SelectRenderable>(null)
  const [text, setText] = useState(spec.input?.value ?? "")
  const [frame, setFrame] = useState(0)

  // Each step brings its own buffer. Without this, moving from `id` to `npm` would arrive with
  // the previous answer already typed in.
  useEffect(() => setText(spec.input?.value ?? ""), [spec.kind, spec.input?.value])

  const spinning = spec.kind === "test" && (result?.running ?? false)
  useOscillator(spinning, 800, motion, (t) => setFrame(Math.floor(t * SPINNER.length) % SPINNER.length))

  const plainInput = spec.input !== undefined && !spec.input.secret

  useKeyboard((key) => {
    if (key.name === "escape") return onCancel()
    // ctrl+b rather than left/right: those belong to the cursor inside a text field.
    if (key.ctrl && key.name === "b") return onBack()
    if (key.name === "tab" && (spec.kind === "key" || spec.kind === "envName")) return onSwitchKeyMode()
    // Enter is claimed here rather than through the `<input>`'s own onSubmit: the OpenTUI
    // intrinsics merge with React's DOM props, so `onSubmit` on an `<input>` is typed as both a
    // value handler and a form-event handler and neither side wins. Only for a plain field —
    // SecretField and `<select>` each handle their own.
    if (plainInput && (key.name === "return" || key.name === "enter")) {
      onSubmit(text)
      return key.stopPropagation()
    }
  })

  const { width: columns, height: rows } = useTerminalDimensions()
  const width = Math.max(34, Math.min(76, columns - 8))

  const choices = spec.kind === "test" ? (result?.outcome ? RESULT_CHOICES(result.outcome.ok) : []) : spec.choices
  const options: SelectOption[] = (choices ?? []).map((choice) => ({
    name: choice.label,
    description: choice.hint ?? "",
    value: choice.value,
  }))
  const perRow = (choices ?? []).some((choice) => choice.hint) ? 2 : 1
  // Prompt, blank, body, blank, summary, plus the border. The list gets whatever is left.
  const chrome = 6 + (spec.error ? 1 : 0)
  const height = Math.max(
    8,
    Math.min(options.length * perRow + chrome, Math.floor(rows * 0.8)),
  )
  useEnter(box, motion, { ms: 140, height })

  const keys = [
    spec.kind === "models" ? "enter toggles" : "enter next",
    setup.history.length > 0 ? "ctrl+b back" : "",
    spec.kind === "key" || spec.kind === "envName" ? "tab source" : "",
    "esc cancel",
  ].filter(Boolean)

  return (
    <Modal>
      <box
        ref={box}
        title={
          spec.position.total > 0
            ? `add a provider — ${spec.title} (${spec.position.index}/${spec.position.total})`
            : `add a provider — ${spec.title}`
        }
        titleColor={theme.accent}
        // A bottom title wider than the box is dropped silently rather than clipped, so it has
        // to be trimmed here or the key legend vanishes entirely on a narrow terminal.
        bottomTitle={clip(keys.join(" · "), width - 4)}
        style={{
          border: true,
          borderStyle: "rounded",
          borderColor: spec.error ? theme.error : theme.accent,
          backgroundColor: theme.panel,
          flexDirection: "column",
          height,
          width,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={theme.fg}>{clip(spec.prompt, width - 4)}</text>
        {spec.hint && <text fg={theme.hint}>{clip(spec.hint, width - 4)}</text>}
        {spec.error && <text fg={theme.error}>{clip(spec.error, width - 4)}</text>}

        <box style={{ height: 1 }} />

        {spec.kind === "test" ? (
          <TestBody theme={theme} result={result} frame={frame} />
        ) : spec.input ? (
          spec.input.secret ? (
            <SecretField value={text} theme={theme} onChange={setText} onSubmit={onSubmit} />
          ) : (
            <input
              focused
              value={text}
              placeholder={spec.input.placeholder ?? ""}
              backgroundColor={theme.panel}
              textColor={theme.fg}
              placeholderColor={theme.muted}
              cursorColor={theme.accent}
              onInput={setText}
            />
          )
        ) : null}

        {options.length > 0 && (
          <select
            ref={list}
            focused
            options={options}
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
              // The models step toggles in place and only leaves on the "done" row, so a
              // multi-select is possible without a widget that supports one.
              if (spec.kind === "models" && value !== " done") return onToggle(value)
              onSubmit(value)
            }}
            style={{ flexGrow: 1 }}
          />
        )}

        {spec.kind === "models" && models?.loading && <text fg={theme.hint}>looking up available models…</text>}
        {spec.kind === "models" && models?.note && <text fg={theme.hint}>{clip(models.note, width - 4)}</text>}

        <box style={{ flexGrow: options.length > 0 ? 0 : 1 }} />
        <text fg={theme.muted}>{clip(summarize(setup.draft), width - 4)}</text>
      </box>
    </Modal>
  )
}

function TestBody({ theme, result, frame }: { theme: Theme; result?: TestState; frame: number }) {
  if (result?.running || !result) {
    return (
      <box style={{ flexDirection: "column" }}>
        <text fg={theme.accent}>{`${SPINNER[frame] ?? SPINNER[0]} sending one token…`}</text>
        {result?.installing && (
          // Said before the await, not after: a cold `bun add` takes tens of seconds, and a
          // silent spinner during it is indistinguishable from a hang.
          <text fg={theme.hint}>installing the provider package first — this can take a while</text>
        )}
      </box>
    )
  }
  const { outcome } = result
  if (!outcome) return null
  if (outcome.ok) {
    return <text fg={theme.success}>{`✓ answered as ${outcome.modelID} in ${outcome.ms}ms`}</text>
  }
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.error}>{`✗ ${outcome.stage}`}</text>
      {outcome.hint && <text fg={theme.hint}>{outcome.hint}</text>}
      {outcome.message.split("\n").slice(0, 3).map((line, index) => (
        <text key={index} fg={theme.muted}>
          {line}
        </text>
      ))}
    </box>
  )
}
