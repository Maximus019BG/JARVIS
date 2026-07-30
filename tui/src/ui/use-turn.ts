import { useCallback, useMemo, useRef, useState } from "react"
import { run, type Usage } from "../agent/agent.ts"
import { appendMessages, createSession, loadSession, type Session } from "../agent/session.ts"
import type { Config } from "../config/config.ts"
import type { Extensions } from "../extend/extensions.ts"
import { PermissionGate, type PermissionAnswer, type PermissionRequest } from "../permission.ts"
import type { ToolSet } from "../tools/index.ts"
import { applyEvent, type Item } from "./transcript.ts"

export type PendingPermission = { request: PermissionRequest; answer: (answer: PermissionAnswer) => void }

/** Everything about the conversation in progress. The UI only renders this. */
export type Turn = {
  session: Session
  items: Item[]
  usage: Usage
  busy: boolean
  permission: PendingPermission | null
  send: (prompt: string, options?: { agent?: string; model?: string }) => void
  note: (text: string, level?: "info" | "error") => void
  newSession: () => void
  resume: (id: string) => void
  clear: () => void
  /** Aborts the running turn. Returns false when there was nothing to abort. */
  interrupt: () => boolean
}

export type UseTurnOptions = {
  config: Config
  cwd: string
  extensions: Extensions
  mcpTools: ToolSet
  session: Session
  /** Startup warnings, seeded into the transcript before anything else. */
  notes: string[]
  agent: string
  model: string
}

/** User messages from a restored session, so a resumed transcript is not blank. */
function restore(session: Session): Item[] {
  return session.messages
    .filter((message) => message.role === "user")
    .map((message) => ({
      kind: "user" as const,
      text: typeof message.content === "string" ? message.content : "(restored message)",
    }))
}

/**
 * Owns the session, the transcript, token usage and the permission prompt, and runs
 * the agent loop. Kept out of the component so the view is just layout.
 */
export function useTurn({ config, cwd, extensions, mcpTools, agent, model, ...initial }: UseTurnOptions): Turn {
  const [session, setSession] = useState(initial.session)
  const [items, setItems] = useState<Item[]>(() => [
    ...initial.notes.map((text) => ({ kind: "note" as const, text, level: "error" as const })),
    ...restore(initial.session),
  ])
  const [busy, setBusy] = useState(false)
  // Session total plus the turn in flight; a turn reports cumulative numbers as it runs.
  const [total, setTotal] = useState<Usage>({ input: 0, output: 0, cost: 0 })
  const [inFlight, setInFlight] = useState<Usage>({ input: 0, output: 0, cost: 0 })
  const [permission, setPermission] = useState<PendingPermission | null>(null)

  const abort = useRef<AbortController | null>(null)
  // `send` is recreated on every model or agent change; the ref keeps it reading the
  // session that is current when it actually runs.
  const sessionRef = useRef(initial.session)
  sessionRef.current = session

  const note = useCallback((text: string, level: "info" | "error" = "info") => {
    setItems((current) => [...current, { kind: "note", text, level }])
  }, [])

  const gate = useMemo(
    () =>
      new PermissionGate(config.permission, (request) =>
        new Promise<PermissionAnswer>((resolve) =>
          setPermission({
            request,
            answer: (answer) => {
              setPermission(null)
              resolve(answer)
            },
          }),
        ),
      ),
    [config.permission],
  )

  const send = useCallback(
    (prompt: string, options: { agent?: string; model?: string } = {}) => {
      const active = sessionRef.current
      setItems((current) => [...current, { kind: "user", text: prompt }])
      appendMessages(active, [{ role: "user", content: prompt }])
      setBusy(true)
      setInFlight({ input: 0, output: 0, cost: 0 })
      const controller = new AbortController()
      abort.current = controller

      void run({
        config,
        cwd,
        messages: active.messages,
        gate,
        agent: options.agent ?? agent,
        model: options.model ?? model,
        extraTools: mcpTools,
        extensions,
        sessionID: active.id,
        abort: controller.signal,
        onEvent: (event) => {
          setItems((current) => applyEvent(current, event))
          if (event.type === "usage") setInFlight(event.usage)
        },
      })
        .then((result) => {
          appendMessages(active, result.messages)
          setTotal((current) => ({
            input: current.input + result.usage.input,
            output: current.output + result.usage.output,
            cost: current.cost + result.usage.cost,
          }))
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) note("interrupted")
          else note(error instanceof Error ? error.message : String(error), "error")
        })
        .finally(() => {
          abort.current = null
          setBusy(false)
          setInFlight({ input: 0, output: 0, cost: 0 })
          setPermission(null)
        })
    },
    [agent, config, cwd, extensions, gate, mcpTools, model, note],
  )

  const swap = useCallback((next: Session, transcript: Item[]) => {
    setSession(next)
    sessionRef.current = next
    setItems(transcript)
  }, [])

  return {
    session,
    items,
    busy,
    permission,
    usage: {
      input: total.input + inFlight.input,
      output: total.output + inFlight.output,
      cost: total.cost + inFlight.cost,
    },
    send,
    note,
    newSession: useCallback(() => {
      swap(createSession(cwd), [])
      setTotal({ input: 0, output: 0, cost: 0 })
    }, [cwd, swap]),
    resume: useCallback(
      (id: string) => {
        const loaded = loadSession(id)
        swap(loaded, restore(loaded))
      },
      [swap],
    ),
    clear: useCallback(() => setItems([]), []),
    interrupt: useCallback(() => {
      if (!abort.current) return false
      abort.current.abort()
      return true
    }, []),
  }
}
