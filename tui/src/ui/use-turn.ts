import type { ModelMessage } from "ai"
import { useCallback, useMemo, useRef, useState } from "react"
import { errorMessage, run, type Usage } from "../agent/agent.ts"
import { attach } from "../agent/attach.ts"
import { compactSession, generateTitle, isOverflow, NothingToCompact } from "../agent/compact.ts"
import { providerOf, record } from "../agent/metrics.ts"
import { remoteAnswer } from "../agent/remote-approval.ts"
import { pushSession } from "../agent/session-sync.ts"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  appendMessages,
  createSession,
  exportMarkdown,
  loadSession,
  setTitle,
  textOf,
  type Session,
} from "../agent/session.ts"
import type { Config } from "../config/config.ts"
import type { Extensions } from "../extend/extensions.ts"
import { persistPermission } from "../config/persist.ts"
import { PermissionGate, type PermissionAnswer, type PermissionRequest } from "../permission.ts"
import type { ToolSet } from "../tools/index.ts"
import { beginGroup, endGroup, redo, undo } from "../tools/snapshot.ts"
import { applyEvent, type Item } from "./transcript.ts"

export type PendingPermission = { request: PermissionRequest; answer: (answer: PermissionAnswer) => void }

/** A question the `ask` tool is waiting on. `""` from `answer` means the user dismissed it. */
export type PendingQuestion = { question: string; options: string[]; answer: (choice: string) => void }

/** Fraction of the context window that triggers an automatic compaction after a turn. */
const COMPACT_AT = 0.85

/** Everything about the conversation in progress. The UI only renders this. */
export type Turn = {
  session: Session
  items: Item[]
  usage: Usage
  busy: boolean
  /** True while a summary is being generated, so the UI can say so. */
  compacting: boolean
  /** The active model's context window, once a turn has resolved it. */
  contextLimit?: number
  /** Prompt tokens on the last turn: how full the window is right now. */
  contextTokens: number
  permission: PendingPermission | null
  /** The `ask` tool's open question, or null. Mutually exclusive with `permission` on screen. */
  question: PendingQuestion | null
  send: (prompt: string, options?: { agent?: string; model?: string }) => void
  note: (text: string, level?: "info" | "error") => void
  newSession: () => void
  resume: (id: string) => void
  clear: () => void
  /** Summarizes the history so far, shrinking what the model carries. */
  compact: () => void
  /** Writes the full session to a markdown file in the workspace. */
  export: () => void
  /** Reverts (or re-applies) the file changes from one turn. */
  history: (direction: "undo" | "redo") => void
  /** Sends the last prompt again, optionally to a different model. */
  retry: (model?: string) => void
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

/**
 * A restored session as transcript items. Both sides of the conversation, because a
 * resumed session showing only your own questions reads as if nothing ever answered.
 */
export function restore(session: Session): Item[] {
  const items: Item[] = []
  for (const message of session.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue
    const { text, calls } = textOf(message.content)
    if (text) items.push({ kind: message.role === "user" ? "user" : "assistant", text })
    if (calls > 0) items.push({ kind: "note", text: `  ✓ ${calls} tool call${calls === 1 ? "" : "s"}`, level: "info" })
  }
  return items
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
  const [compacting, setCompacting] = useState(false)
  const [contextLimit, setContextLimit] = useState<number | undefined>()
  // How full the window was on the last turn, which is what the status line should show.
  const [contextTokens, setContextTokens] = useState(0)
  // Session total plus the turn in flight; a turn reports cumulative numbers as it runs.
  const [total, setTotal] = useState<Usage>({ input: 0, output: 0, cost: 0 })
  const [inFlight, setInFlight] = useState<Usage>({ input: 0, output: 0, cost: 0 })
  const [permission, setPermission] = useState<PendingPermission | null>(null)
  const [question, setQuestion] = useState<PendingQuestion | null>(null)

  const abort = useRef<AbortController | null>(null)
  // Read files live as long as the session does, so the model doesn't re-read a file
  // every turn just to satisfy `edit`'s prior-read requirement.
  const read = useRef(new Map<string, number>())
  // One generated title per session; the derived one stands in until it arrives.
  const titled = useRef(initial.session.messages.length > 0)
  // Cost so far and the next figure to stop at, as refs so `send` sees them unstaled.
  const spent = useRef(0)
  const ceiling = useRef(config.maxCost)
  // The last prompt, so /retry can send it again — possibly to a different model.
  const lastPrompt = useRef("")
  // `send` is recreated on every model or agent change; the ref keeps it reading the
  // session that is current when it actually runs.
  const sessionRef = useRef(initial.session)
  sessionRef.current = session

  const note = useCallback((text: string, level: "info" | "error" = "info") => {
    setItems((current) => [...current, { kind: "note", text, level }])
  }, [])

  /**
   * Resolves a promise into the on-screen prompt. Shared by the gate and the cost guard.
   *
   * With `remoteApproval` on, the same request also goes to the paired cloud and whichever
   * side answers first wins: a local answer aborts the poll (which cancels the remote row),
   * a remote answer takes the dialog down. `return local` on the giving-up branch is what
   * keeps the loser harmless — the race simply carries on waiting for the terminal.
   */
  const ask = useCallback(
    (request: PermissionRequest) => {
      const controller = new AbortController()
      const local = new Promise<PermissionAnswer>((resolve) =>
        setPermission({
          request,
          answer: (answer) => {
            setPermission(null)
            controller.abort()
            resolve(answer)
          },
        }),
      )
      if (!config.remoteApproval) return local
      return Promise.race([
        local,
        remoteAnswer(request, controller.signal, note).then((answer) => {
          if (!answer) return local
          setPermission(null)
          return answer
        }),
      ])
    },
    [config.remoteApproval, note],
  )

  /**
   * The `ask` tool's half of the same trick: a promise the picker resolves. Deliberately
   * not routed through the permission gate — `PermissionAnswer` is the type every security
   * decision in the app pivots on, and widening it to carry a free string so a tool could
   * ask about millimetres would be a poor trade.
   */
  const askUser = useCallback(
    (text: string, options: string[]) =>
      new Promise<string>((resolve) =>
        setQuestion({
          question: text,
          options,
          answer: (choice) => {
            setQuestion(null)
            resolve(choice)
          },
        }),
      ),
    [],
  )

  const gate = useMemo(
    () =>
      new PermissionGate(config.permission, ask, undefined, undefined, (request) => {
        if (!config.persistGrants) return
        // `bash:git ` rather than `bash:git status`: the subject is one exact command, and
        // persisting that verbatim would litter the config with near-duplicates.
        const key = request.subject && request.tool === "bash" ? `${request.tool}:${request.subject}` : request.tool
        try {
          note(`saved permission "${key}": allow to ${persistPermission(cwd, key, "allow")}`)
        } catch (error) {
          note(`could not save the permission: ${errorMessage(error)}`, "error")
        }
      }),
    [ask, config.permission, config.persistGrants, cwd, note],
  )

  /**
   * Replaces the history the model carries with a summary. The on-screen transcript is
   * deliberately left alone: it is what the user reads, and shrinking it would look like
   * jarvis had lost the conversation. Only the model's view gets smaller.
   */
  const runCompact = useCallback(
    async (reason: "manual" | "auto" | "overflow") => {
      const active = sessionRef.current
      setCompacting(true)
      try {
        const { dropped } = await compactSession(config, active)
        note(`compacted ${dropped} messages into a summary${reason === "manual" ? "" : ` (${reason})`}`)
        // The occupancy figure described history the model no longer carries. Cost stays:
        // that money was really spent.
        setContextTokens(0)
        return true
      } catch (error) {
        note(errorMessage(error), error instanceof NothingToCompact ? "info" : "error")
        return false
      } finally {
        setCompacting(false)
      }
    },
    [config, note],
  )

  const send = useCallback(
    (prompt: string, options: { agent?: string; model?: string } = {}) => {
      const active = sessionRef.current
      lastPrompt.current = prompt
      setItems((current) => [...current, { kind: "user", text: prompt }])
      // `@screenshot.png` becomes something the model can actually look at.
      const attached = attach(prompt, cwd)
      for (const line of attached.notes) note(line)
      appendMessages(active, [{ role: "user", content: attached.content }])
      setBusy(true)
      const started = Date.now()
      setInFlight({ input: 0, output: 0, cost: 0 })
      // Everything this turn writes undoes as one step.
      beginGroup(active.id)
      const controller = new AbortController()
      abort.current = controller

      // Reads `active.messages` when called, not when defined, so a retry after
      // compaction sends the shortened history rather than the one that overflowed.
      const attempt = () =>
        run({
          config,
          cwd,
          messages: active.messages,
          gate,
          agent: options.agent ?? agent,
          model: options.model ?? model,
          extraTools: mcpTools,
          extensions,
          sessionID: active.id,
          read: read.current,
          abort: controller.signal,
          ask: askUser,
          onEvent: (event) => {
            setItems((current) => applyEvent(current, event))
            if (event.type === "usage") setInFlight(event.usage)
          },
        })

      void (async () => {
        try {
          // Nobody wants to discover a runaway loop on next month's invoice.
          if (config.maxCost > 0 && spent.current >= ceiling.current) {
            const answer = await ask({
              tool: "budget",
              title: `this session has cost $${spent.current.toFixed(2)}`,
              detail: `The configured ceiling is $${config.maxCost.toFixed(2)} (maxCost). Continue?`,
            })
            if (answer === "reject") {
              note(`stopped at $${spent.current.toFixed(2)} — raise maxCost or start a new session`)
              return
            }
            // Ask again after another maxCost, not on every turn from here on.
            ceiling.current = spent.current + config.maxCost
          }

          let result
          try {
            result = await attempt()
          } catch (error) {
            // The window filled up. Summarizing and retrying is the only thing that can
            // help, and the alternative is a dead session.
            if (controller.signal.aborted || !isOverflow(error)) throw error
            note("context window exceeded — compacting and retrying")
            if (!(await runCompact("overflow"))) throw error
            result = await attempt()
          }

          appendMessages(active, result.messages)
          // An interruption records as a success: the tokens were really spent and the
          // provider did not fail. `result.error` is set when the failure was already
          // reported as an event, so it counts as a failure without being noted twice.
          record({
            at: started,
            ms: Date.now() - started,
            provider: providerOf(result.model),
            model: result.model,
            input: result.usage.input,
            output: result.usage.output,
            cost: result.usage.cost,
            error: result.error,
            session: active.id,
            agent: options.agent ?? agent,
          })
          spent.current += result.usage.cost
          setTotal((current) => ({
            input: current.input + result.usage.input,
            output: current.output + result.usage.output,
            cost: current.cost + result.usage.cost,
          }))
          setContextLimit(result.contextLimit)
          setContextTokens(result.contextTokens)

          // A better label than the first line of the prompt, which is useless when the
          // prompt was a pasted stack trace. One cheap call, once per session.
          if (!titled.current) {
            titled.current = true
            void generateTitle(config, active.messages)
              .then((title) => {
                if (title) setTitle(active, title)
              })
              .catch(() => {
                // The derived title is already in place; a failed rename is not worth saying.
              })
          }

          if (result.interrupted) note("interrupted")
          else if (result.contextLimit && result.contextTokens > result.contextLimit * COMPACT_AT) {
            await runCompact("auto")
          }
        } catch (error) {
          if (controller.signal.aborted) note("interrupted")
          else {
            const message = errorMessage(error)
            note(message, "error")
            // A hard failure never reached a response, so the SDK reports no usage. The
            // model is the one asked for rather than the one `run` resolved, which is only
            // wrong when an agent overrides it — a misattributed failure, never a wrong total.
            record({
              at: started,
              ms: Date.now() - started,
              provider: providerOf(options.model ?? model),
              model: options.model ?? model,
              input: 0,
              output: 0,
              cost: 0,
              error: message,
              session: active.id,
              agent: options.agent ?? agent,
            })
          }
        } finally {
          endGroup(active.id)
          abort.current = null
          setBusy(false)
          setInFlight({ input: 0, output: 0, cost: 0 })
          setPermission(null)
          // An interrupt must not leave a modal up with nothing behind it to answer.
          setQuestion(null)
          // Mirror the session now rather than on the next launch. Without this a session
          // being steered from the web never shows its answers there — the startup sweep
          // deliberately skips whichever session is live. No-op unless `syncSessions` is on,
          // and never awaited into the turn: a slow upload must not delay the next prompt.
          void pushSession(config, active).catch(() => {
            // A failed mirror is not the user's problem; the startup sweep will catch up.
          })
        }
      })()
    },
    [agent, ask, askUser, config, cwd, extensions, gate, mcpTools, model, note, runCompact],
  )

  /**
   * Sends the last prompt again. The point is the optional model: when a turn fails or
   * answers badly, trying the same question on a stronger model is the obvious next move
   * and otherwise means retyping it.
   */
  const retry = useCallback(
    (override?: string) => {
      if (!lastPrompt.current) return note("nothing to retry yet")
      note(`retrying${override ? ` with ${override}` : ""}`)
      send(lastPrompt.current, override ? { model: override } : {})
    },
    [note, send],
  )

  const swap = useCallback((next: Session, transcript: Item[]) => {
    setSession(next)
    sessionRef.current = next
    setItems(transcript)
    read.current.clear()
    titled.current = next.messages.length > 0
  }, [])

  return {
    session,
    items,
    busy,
    compacting,
    contextLimit,
    contextTokens,
    permission,
    question,
    usage: {
      input: total.input + inFlight.input,
      output: total.output + inFlight.output,
      cost: total.cost + inFlight.cost,
    },
    send,
    retry,
    note,
    compact: useCallback(() => void runCompact("manual"), [runCompact]),
    history: useCallback(
      (direction: "undo" | "redo") => {
        const active = sessionRef.current
        const result = direction === "undo" ? undo(active.id) : redo(active.id)
        if ("error" in result) return note(result.error)
        // The files on disk no longer match what the model was told they contain.
        for (const path of result.files) read.current.delete(path)
        note(`${direction} — ${result.files.length} file${result.files.length === 1 ? "" : "s"} restored`)
      },
      [note],
    ),
    export: useCallback(() => {
      const active = sessionRef.current
      const file = join(cwd, `jarvis-${active.id}.md`)
      try {
        writeFileSync(file, exportMarkdown(active.id))
        note(`exported to ${file}`)
      } catch (error) {
        note(errorMessage(error), "error")
      }
    }, [cwd, note]),
    newSession: useCallback(() => {
      swap(createSession(cwd), [])
      setTotal({ input: 0, output: 0, cost: 0 })
      setContextTokens(0)
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
