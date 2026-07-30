import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useMemo, useRef, useState } from "react"
import { run, type Usage } from "../agent.ts"
import { loadAgents, resolveAgent, DEFAULT_AGENT } from "../agent-def.ts"
import { expand, loadCommands, parseCommandLine, type Command } from "../command.ts"
import type { Config } from "../config.ts"
import { summary, type Extensions } from "../extensions.ts"
import { describe, type Keymap } from "../keybinds.ts"
import type { McpSession } from "../mcp.ts"
import { PermissionGate, type PermissionAnswer, type PermissionRequest } from "../permission.ts"
import { defaultModelID, listModels } from "../provider.ts"
import { appendMessages, createSession, listSessions, loadSession, type Session } from "../session.ts"
import { listThemes, loadTheme, type Theme } from "../theme.ts"
import { Picker, PermissionPrompt, type Choice } from "./dialog.tsx"
import { Editor, type EditorHandle } from "./editor.tsx"
import { Messages } from "./messages.tsx"
import { Status } from "./status.tsx"
import { applyEvent, type Item } from "./transcript.ts"

export type AppProps = {
  config: Config
  cwd: string
  session: Session
  mcp: McpSession
  extensions: Extensions
  /** Startup warnings and first-run guidance, shown as notes in the transcript. */
  notes: string[]
  theme: Theme
  keymap: Keymap
  model?: string
  agent?: string
}

type DialogKind = "model" | "agent" | "session" | "command" | "file" | "theme"

const HELP = (keymap: Keymap) =>
  [
    "keys",
    `  ${describe(keymap.submit)}  send        ${describe(keymap.newline)}  newline`,
    `  ${describe(keymap.interrupt)}  interrupt   ${describe(keymap.exit)}  quit`,
    `  ${describe(keymap.palette)}  commands    ${describe(keymap.modelPicker)}  model`,
    `  ${describe(keymap.agentPicker)}  agent       ${describe(keymap.sessionPicker)}  sessions`,
    `  ${describe(keymap.filePicker)}  insert file path`,
    `  ${describe(keymap.newSession)}  new session ${describe(keymap.clear)}  clear screen`,
    "",
    "jarvis.jsonc configures providers, agents, permissions, keybinds and mcp servers.",
    "`jarvis init` scaffolds a .jarvis directory for project agents, commands, skills,",
    "custom tools, plugins and themes. /extensions shows what is loaded.",
  ].join("\n")

/** User messages from a restored session, so a resumed transcript is not blank. */
const restore = (session: Session): Item[] =>
  session.messages
    .filter((message) => message.role === "user")
    .map((message) => ({
      kind: "user" as const,
      text: typeof message.content === "string" ? message.content : "(restored message)",
    }))

export function App({ config, cwd, mcp, extensions, keymap, ...initial }: AppProps) {
  const { width } = useTerminalDimensions()
  const agents = useMemo(() => loadAgents(config, cwd), [config, cwd])
  const commands = useMemo(() => loadCommands(cwd), [cwd])

  const [theme, setTheme] = useState(initial.theme)
  const [session, setSession] = useState(initial.session)
  const [items, setItems] = useState<Item[]>(() => [
    ...initial.notes.map((text) => ({ kind: "note" as const, text, level: "error" as const })),
    ...restore(initial.session),
  ])
  const [busy, setBusy] = useState(false)
  // Session total plus the turn in flight; the turn reports cumulative numbers as it runs.
  const [total, setTotal] = useState<Usage>({ input: 0, output: 0, cost: 0 })
  const [turn, setTurn] = useState<Usage>({ input: 0, output: 0, cost: 0 })
  const usage: Usage = {
    input: total.input + turn.input,
    output: total.output + turn.output,
    cost: total.cost + turn.cost,
  }
  const [agent, setAgent] = useState(initial.agent ?? DEFAULT_AGENT)
  const [model, setModel] = useState(
    // No providers configured is a valid first-run state; the note in the transcript
    // explains it, so show a placeholder instead of refusing to start.
    () => initial.model ?? agents[initial.agent ?? DEFAULT_AGENT]?.model ?? listModels(config)[0]?.id ?? "no model",
  )
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [permission, setPermission] = useState<{ request: PermissionRequest; answer: (a: PermissionAnswer) => void } | null>(null)

  const editor = useRef<EditorHandle>(null)
  const scroll = useRef<ScrollBoxRenderable>(null)
  const abort = useRef<AbortController | null>(null)
  const sessionRef = useRef(initial.session)
  sessionRef.current = session

  const note = useCallback((text: string, level: "info" | "error" = "info") => {
    setItems((current) => [...current, { kind: "note", text, level }])
  }, [])

  const gate = useMemo(
    () =>
      new PermissionGate(
        config.permission,
        (request) => new Promise<PermissionAnswer>((resolve) => setPermission({ request, answer: resolve })),
      ),
    [config.permission],
  )

  const send = useCallback(
    async (prompt: string, options: { agent?: string; model?: string } = {}) => {
      const active = sessionRef.current
      setItems((current) => [...current, { kind: "user", text: prompt }])
      appendMessages(active, [{ role: "user", content: prompt }])
      setBusy(true)
      setTurn({ input: 0, output: 0, cost: 0 })
      const controller = new AbortController()
      abort.current = controller
      try {
        const result = await run({
          config,
          cwd,
          messages: active.messages,
          gate,
          agent: options.agent ?? agent,
          model: options.model ?? model,
          extraTools: mcp.tools,
          extensions,
          sessionID: active.id,
          abort: controller.signal,
          onEvent: (event) => {
            setItems((current) => applyEvent(current, event))
            if (event.type === "usage") setTurn(event.usage)
          },
        })
        appendMessages(active, result.messages)
        setTotal((current) => ({
          input: current.input + result.usage.input,
          output: current.output + result.usage.output,
          cost: current.cost + result.usage.cost,
        }))
      } catch (error) {
        if (!controller.signal.aborted) note(error instanceof Error ? error.message : String(error), "error")
        else note("interrupted")
      } finally {
        abort.current = null
        setBusy(false)
        setTurn({ input: 0, output: 0, cost: 0 })
        setPermission(null)
      }
    },
    [agent, config, cwd, extensions, gate, mcp.tools, model, note],
  )

  const newSession = useCallback(() => {
    const created = createSession(cwd)
    setSession(created)
    sessionRef.current = created
    setItems([])
    setTotal({ input: 0, output: 0, cost: 0 })
  }, [cwd])

  const runCommand = useCallback(
    (command: Command, args: string) => {
      if (command.kind === "prompt") {
        void send(expand(command, args), { agent: command.agent, model: command.model })
        return
      }
      switch (command.name) {
        case "help":
          note(HELP(keymap))
          break
        case "new":
          newSession()
          break
        case "clear":
          setItems([])
          break
        case "model":
          setDialog("model")
          break
        case "agent":
          setDialog("agent")
          break
        case "sessions":
          setDialog("session")
          break
        case "theme":
          setDialog("theme")
          break
        case "mcp":
          note(
            mcp.status.length === 0
              ? "no mcp servers configured"
              : mcp.status.map((s) => `${s.server}: ${s.error ? `error — ${s.error}` : `${s.tools} tools`}`).join("\n"),
          )
          break
        case "extensions":
          note(
            [
              summary(extensions),
              ...Object.keys(extensions.tools).map((name) => `tool   ${name}`),
              ...extensions.skills.map((skill) => `skill  ${skill.name} — ${skill.description}`),
              ...extensions.errors.map((error) => `error  ${error}`),
            ].join("\n"),
          )
          break
        case "exit":
          process.exit(0)
        default:
          note(`unhandled command /${command.name}`, "error")
      }
    },
    [extensions, keymap, mcp.status, newSession, note, send],
  )

  const submit = useCallback(
    (text: string) => {
      const parsed = parseCommandLine(text)
      if (!parsed) {
        void send(text)
        return
      }
      const command = commands.find((entry) => entry.name === parsed.name)
      if (!command) {
        note(`unknown command /${parsed.name} — try /help`, "error")
        return
      }
      runCommand(command, parsed.args)
    },
    [commands, note, runCommand, send],
  )

  useKeyboard(
    (key) => {
      if (permission || dialog) return
      const is = (action: keyof Keymap) =>
        key.name === keymap[action].name &&
        Boolean(key.ctrl) === keymap[action].ctrl &&
        Boolean(key.shift) === keymap[action].shift
      if (is("exit")) {
        if (busy) abort.current?.abort()
        else process.exit(0)
      } else if (is("interrupt") && busy) abort.current?.abort()
      else if (is("clear")) setItems([])
      else if (is("palette")) setDialog("command")
      else if (is("modelPicker")) setDialog("model")
      else if (is("agentPicker")) setDialog("agent")
      else if (is("sessionPicker")) setDialog("session")
      else if (is("filePicker")) setDialog("file")
      else if (is("newSession")) newSession()
      else if (is("scrollUp")) scroll.current?.scrollBy({ x: 0, y: -10 })
      else if (is("scrollDown")) scroll.current?.scrollBy({ x: 0, y: 10 })
    },
    { release: false },
  )

  const choices = useMemo<Choice[]>(() => {
    switch (dialog) {
      case "model":
        return listModels(config).map((entry) => ({ value: entry.id, label: entry.id, hint: entry.provider }))
      case "agent":
        return Object.values(agents).map((entry) => ({ value: entry.name, label: entry.name, hint: entry.description }))
      case "session":
        return listSessions(cwd).map((entry) => ({
          value: entry.id,
          label: entry.title,
          hint: new Date(entry.created).toLocaleString(),
        }))
      case "command":
        return commands.map((entry) => ({ value: entry.name, label: `/${entry.name}`, hint: entry.description }))
      case "theme":
        return listThemes(cwd).map((name) => ({ value: name, label: name }))
      case "file":
        return [...new Bun.Glob("**/*").scanSync({ cwd, onlyFiles: true })]
          .filter((path) => !path.includes("node_modules") && !path.startsWith("."))
          .slice(0, 500)
          .map((path) => ({ value: path, label: path }))
      default:
        return []
    }
  }, [agents, commands, config, cwd, dialog])

  const pick = useCallback(
    (value: string) => {
      const kind = dialog
      setDialog(null)
      switch (kind) {
        case "model":
          setModel(value)
          break
        case "agent": {
          setAgent(value)
          const chosen = resolveAgent(agents, value)
          if (chosen.model) setModel(chosen.model)
          break
        }
        case "session": {
          const loaded = loadSession(value)
          setSession(loaded)
          sessionRef.current = loaded
          setItems(restore(loaded))
          break
        }
        case "command": {
          const command = commands.find((entry) => entry.name === value)
          if (command) runCommand(command, "")
          break
        }
        case "theme":
          setTheme(loadTheme(value, cwd))
          break
        case "file":
          editor.current?.insert(value)
          break
        default:
          break
      }
    },
    [agents, commands, cwd, dialog, runCommand],
  )

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: theme.bg }}>
      <scrollbox
        ref={scroll}
        stickyScroll
        stickyStart="bottom"
        style={{
          flexGrow: 1,
          rootOptions: { backgroundColor: theme.bg },
          viewportOptions: { backgroundColor: theme.bg },
          contentOptions: { backgroundColor: theme.bg, paddingLeft: 1, paddingRight: 1 },
          scrollbarOptions: { trackOptions: { foregroundColor: theme.border, backgroundColor: theme.bg } },
        }}
      >
        <Messages items={items} theme={theme} streaming={busy} />
      </scrollbox>

      {permission && (
        <PermissionPrompt
          request={permission.request}
          theme={theme}
          onAnswer={(answer) => {
            permission.answer(answer)
            setPermission(null)
          }}
        />
      )}

      {dialog && !permission && (
        <Picker
          title={dialog}
          choices={choices}
          theme={theme}
          onPick={pick}
          onCancel={() => setDialog(null)}
        />
      )}

      {!permission && !dialog && (
        <Editor theme={theme} keymap={keymap} busy={busy} handle={editor} onSubmit={submit} />
      )}

      <Status
        theme={theme}
        cwd={cwd}
        model={model}
        agent={agent}
        usage={usage}
        busy={busy}
        hint={width > 90 ? `${describe(keymap.palette)} commands` : undefined}
      />
    </box>
  )
}
