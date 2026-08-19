import type { BoxRenderable, SelectOption, SelectRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import type { Theme } from "../../config/theme.ts"
import { useEnter, useOscillator, type MotionLevel } from "../motion.ts"
import { SKIP_EMAIL, type Pair, type StepSpec } from "../pair-setup.ts"
import { clip, Modal } from "./dialog.tsx"

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/**
 * The `/pair` overlay. Presentational: every decision about what to ask and whether an
 * answer is acceptable belongs to the reducer in pair-setup.ts, so this renders a
 * `StepSpec` and reports back what the reader did.
 *
 * Built on `Modal` rather than on `Wizard`: that one is welded to provider concerns — a
 * connection test, a masked key field, a multi-select of models — and knows nothing about a
 * QR block or a countdown. Sharing the primitive underneath both is the part worth sharing.
 */
export function PairWizard({
  pair,
  spec,
  theme,
  motion,
  onSubmit,
  onBack,
  onCancel,
}: {
  pair: Pair
  spec: StepSpec
  theme: Theme
  motion: MotionLevel
  onSubmit: (value: string) => void
  onBack: () => void
  onCancel: () => void
}) {
  const box = useRef<BoxRenderable>(null)
  const list = useRef<SelectRenderable>(null)
  const [text, setText] = useState(spec.input?.value ?? "")
  const [frame, setFrame] = useState(0)

  // Each step brings its own buffer, so moving from `url` to `email` does not arrive with
  // the previous answer already typed in.
  useEffect(() => setText(spec.input?.value ?? ""), [spec.kind, spec.input?.value])

  const waiting = spec.kind === "waiting"
  useOscillator(waiting, 800, motion, (t) => setFrame(Math.floor(t * SPINNER.length) % SPINNER.length))

  const hasInput = spec.input !== undefined

  useKeyboard((key) => {
    if (key.name === "escape") return onCancel()
    // ctrl+b rather than left/right: those belong to the cursor inside a text field.
    if (key.ctrl && key.name === "b") return onBack()
    // tab skips the optional email rather than making "leave it blank" a thing to discover.
    if (key.name === "tab" && spec.kind === "email") return onSubmit(SKIP_EMAIL)
    if (hasInput && (key.name === "return" || key.name === "enter")) {
      onSubmit(text)
      return key.stopPropagation()
    }
    if (spec.kind === "done" && (key.name === "return" || key.name === "enter")) return onCancel()
  })

  const { width: columns, height: rows } = useTerminalDimensions()
  const width = Math.max(34, Math.min(76, columns - 8))

  const options: SelectOption[] = (spec.choices ?? []).map((choice) => ({
    name: choice.label,
    description: choice.hint ?? "",
    value: choice.value,
  }))
  const perRow = (spec.choices ?? []).some((choice) => choice.hint) ? 2 : 1

  // A QR is 17 rows on its own. Rendering it into a box that cannot hold it produces a
  // scrambled half-QR that no phone will read, which is worse than not offering one — so it
  // is dropped, and the URL and code below it still do the job.
  const qr = pair.code?.qr?.replace(/\n+$/, "").split("\n") ?? []
  const showQr = waiting && qr.length > 0 && rows >= qr.length + 12 && columns >= (qr[0]?.length ?? 0) + 8

  const chrome = 6 + (spec.error ? 1 : 0)
  const body = showQr ? qr.length + 6 : waiting ? 7 : options.length * perRow
  const height = Math.max(8, Math.min(body + chrome, Math.floor(rows * 0.9)))
  useEnter(box, motion, { ms: 140, height })

  const keys = [
    spec.kind === "done" ? "enter close" : hasInput ? "enter next" : "enter choose",
    spec.kind === "email" ? "tab skip" : "",
    pair.history.length > 0 && !waiting ? "ctrl+b back" : "",
    "esc cancel",
  ].filter(Boolean)

  return (
    <Modal>
      <box
        ref={box}
        title={
          spec.position.total > 0
            ? `pair this device — ${spec.title} (${spec.position.index}/${spec.position.total})`
            : `pair this device — ${spec.title}`
        }
        titleColor={theme.accent}
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

        {spec.kind === "status" && <StatusBody pair={pair} theme={theme} width={width} />}
        {spec.kind === "confirm" && <ConfirmBody pair={pair} theme={theme} width={width} />}
        {waiting && (
          <WaitingBody pair={pair} theme={theme} width={width} frame={frame} qr={showQr ? qr : []} />
        )}
        {spec.kind === "done" && <DoneBody pair={pair} theme={theme} width={width} />}

        {spec.input && (
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
        )}

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
            onSelect={(_, option) => option && onSubmit(String(option.value))}
            style={{ flexGrow: 1 }}
          />
        )}

        <box style={{ flexGrow: 1 }} />
      </box>
    </Modal>
  )
}

function Row({ label, value, theme, width }: { label: string; value: string; theme: Theme; width: number }) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={theme.muted}>{label.padEnd(12)}</text>
      <text fg={theme.fg}>{clip(value, width - 18)}</text>
    </box>
  )
}

function StatusBody({ pair, theme, width }: { pair: Pair; theme: Theme; width: number }) {
  return (
    <box style={{ flexDirection: "column" }}>
      <Row label="device" value={pair.paired?.deviceId ?? "—"} theme={theme} width={width} />
      <Row label="name" value={pair.draft.name} theme={theme} width={width} />
      <Row label="cloud" value={pair.draft.baseUrl} theme={theme} width={width} />
      <Row label="workstation" value={pair.paired?.workstationId ?? "—"} theme={theme} width={width} />
      <box style={{ height: 1 }} />
    </box>
  )
}

/**
 * What the approver is about to see, shown before it is sent.
 *
 * The fingerprint is the whole defence on the other end — the person clicking Approve is
 * asked whether it matches this machine — so it is worth reading here first, rather than
 * discovering it for the first time on a web page.
 */
function ConfirmBody({ pair, theme, width }: { pair: Pair; theme: Theme; width: number }) {
  return (
    <box style={{ flexDirection: "column" }}>
      <Row label="fingerprint" value={pair.draft.fingerprint} theme={theme} width={width} />
      <Row label="platform" value={pair.draft.platform} theme={theme} width={width} />
      {pair.draft.email ? (
        <Row label="approver" value={pair.draft.email} theme={theme} width={width} />
      ) : (
        <text fg={theme.hint}>{clip("no account named — approve it with the code", width - 4)}</text>
      )}
      <box style={{ height: 1 }} />
    </box>
  )
}

function WaitingBody({
  pair,
  theme,
  width,
  frame,
  qr,
}: {
  pair: Pair
  theme: Theme
  width: number
  frame: number
  qr: string[]
}) {
  const left = pair.secondsLeft
  const countdown =
    left === undefined ? "" : `expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`

  return (
    <box style={{ flexDirection: "column" }}>
      {qr.map((line, index) => (
        <text key={index} fg={theme.fg}>
          {line}
        </text>
      ))}
      {pair.code && (
        <>
          <text fg={theme.accent}>{clip(pair.code.verificationUriComplete, width - 4)}</text>
          <text fg={theme.fg}>{`code  ${pair.code.userCode}`}</text>
        </>
      )}
      {pair.draft.email && (
        <text fg={theme.hint}>{clip(`or approve it as ${pair.draft.email} in the Devices tab`, width - 4)}</text>
      )}
      <box style={{ height: 1 }} />
      <box style={{ flexDirection: "row" }}>
        <text fg={theme.accent}>{`${SPINNER[frame] ?? SPINNER[0]} waiting for approval`}</text>
        {countdown && <text fg={theme.muted}>{`  ${countdown}`}</text>}
      </box>
    </box>
  )
}

function DoneBody({ pair, theme, width }: { pair: Pair; theme: Theme; width: number }) {
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.success}>{clip(`✓ paired as ${pair.paired?.deviceId ?? ""}`, width - 4)}</text>
      <box style={{ height: 1 }} />
      <text fg={theme.hint}>{clip("JARVIS (hosted) is now available in /provider — no API key needed.", width - 4)}</text>
    </box>
  )
}
