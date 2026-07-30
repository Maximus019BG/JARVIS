import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useMemo, useRef, useState } from "react"
import { DEFAULT_AGENT, loadAgents, resolveAgent } from "../agent/agent-def.ts"
import { listModels } from "../agent/provider.ts"
import type { Session } from "../agent/session.ts"
import type { Config } from "../config/config.ts"
import { describe, matches, type Action, type Keymap } from "../config/keybinds.ts"
import { loadTheme, type Theme } from "../config/theme.ts"
import { loadCommands, parseCommandLine } from "../extend/command.ts"
import type { Extensions } from "../extend/extensions.ts"
import type { McpSession } from "../extend/mcp.ts"
import { runCommand } from "./builtin-commands.ts"
import { useVim } from "./vim.ts"
import { Activity } from "./components/activity.tsx"
import { PermissionPrompt, Picker } from "./components/dialog.tsx"
import { Editor, type EditorHandle } from "./components/editor.tsx"
import { Messages } from "./components/messages.tsx"
import { Status } from "./components/status.tsx"
import { Suggestions } from "./components/suggestions.tsx"
import { Welcome } from "./components/welcome.tsx"
import type { MotionLevel } from "./motion.ts"
import { listFiles, pickerChoices, PICKER_TITLES, type PickerKind } from "./pickers.ts"
import { suggest, type Suggestion } from "./suggest.ts"
import { useTurn } from "./use-turn.ts"

export type AppProps = {
  config: Config
  cwd: string
  session: Session
  mcp: McpSession
  extensions: Extensions
  /** Startup warnings and first-run guidance, shown as notes in the transcript. */
  notes: string[]
  branch?: string
  theme: Theme
  motion: MotionLevel
  keymap: Keymap
  model?: string
  agent?: string
}

const SCROLL_LINES = 10
const QUIT_WINDOW_MS = 2000

export function App({ config, cwd, mcp, extensions, keymap, notes, branch, motion, ...initial }: AppProps) {
  const { width, height } = useTerminalDimensions()
  const agents = useMemo(() => loadAgents(config, cwd), [config, cwd])
  const commands = useMemo(() => loadCommands(cwd), [cwd])
  // One filesystem walk per session; the picker and the `@` strip both read this list.
  const files = useMemo(() => listFiles(cwd), [cwd])

  const [theme, setTheme] = useState(initial.theme)
  const [agent, setAgent] = useState(initial.agent ?? DEFAULT_AGENT)
  const [model, setModel] = useState(
    // No providers configured is a valid first-run state; the note in the transcript
    // explains it, so show a placeholder instead of refusing to start.
    () => initial.model ?? agents[initial.agent ?? DEFAULT_AGENT]?.model ?? listModels(config)[0]?.id ?? "no model",
  )
  const [picker, setPicker] = useState<PickerKind | null>(null)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [selected, setSelected] = useState(0)
  const [quitting, setQuitting] = useState(false)

  const turn = useTurn({ config, cwd, extensions, mcpTools: mcp.tools, session: initial.session, notes, agent, model })
  const editor = useRef<EditorHandle>(null)
  const scroll = useRef<ScrollBoxRenderable>(null)
  const history = useRef<string[]>([])
  const browse = useRef({ index: -1, draft: "" })

  // The config value is available before the first turn; the turn's value can also come
  // from the models.dev catalog, so it wins once a turn has actually resolved the model.
  const configured = useMemo(() => listModels(config).find((m) => m.id === model)?.contextLimit, [config, model])
  const contextLimit = turn.contextLimit ?? configured
  const vim = useVim(editor, config.vim)

  const dispatch = useCallback(
    (name: string, args: string) => {
      const command = commands.find((entry) => entry.name === name)
      if (!command) return turn.note(`unknown command /${name} — try /help`, "error")
      runCommand(command, args, {
        turn,
        keymap,
        mcp,
        extensions,
        openPicker: setPicker,
        quit: () => process.exit(0),
      })
    },
    [commands, extensions, keymap, mcp, turn],
  )

  const shell = useCallback(
    (command: string) => {
      if (!command) return
      const result = Bun.spawnSync(["bash", "-c", command], { cwd, env: { ...process.env, JARVIS: "1" } })
      const output = [result.stdout.toString(), result.stderr.toString()].filter((part) => part.trim()).join("\n")
      turn.note(`! ${command}\n${output.trimEnd() || `(exit ${result.exitCode})`}`, result.exitCode === 0 ? "info" : "error")
    },
    [cwd, turn],
  )

  const submit = useCallback(
    (text: string) => {
      history.current.push(text)
      browse.current = { index: -1, draft: "" }
      setSuggestion(null)
      vim.reset()
      // `!cmd` runs a shell command without spending a turn on it, for the constant
      // small checks — git status, a test run — that do not need the model at all.
      if (text.startsWith("!")) return shell(text.slice(1).trim())
      const parsed = parseCommandLine(text)
      if (parsed) dispatch(parsed.name, parsed.args)
      else turn.send(text)
    },
    [dispatch, shell, turn],
  )

  const change = useCallback(
    (text: string) => {
      const next = suggest(text, commands, files) ?? null
      // Typing prose is the common case: keep the same reference so React can bail out
      // instead of reconciling the whole transcript on every keystroke.
      setSuggestion((current) => (current === null && next === null ? current : next))
      setSelected(0)
    },
    [commands, files],
  )

  const accept = useCallback(() => {
    const choice = suggestion?.choices[selected]
    if (!suggestion || !choice) return
    editor.current?.replaceToken(suggestion.token, suggestion.kind === "command" ? choice.label : choice.value)
    setSuggestion(null)
  }, [selected, suggestion])

  /** Walks the prompt history, keeping the half-written draft to come back to. */
  const recall = useCallback((direction: -1 | 1) => {
    const entries = history.current
    const state = browse.current
    if (entries.length === 0) return
    if (state.index === -1) {
      if (direction === 1) return
      state.draft = editor.current?.text() ?? ""
      state.index = entries.length - 1
    } else {
      const next = state.index + direction
      if (next >= entries.length) {
        state.index = -1
        editor.current?.set(state.draft)
        return
      }
      if (next < 0) return
      state.index = next
    }
    editor.current?.set(entries[state.index]!)
  }, [])

  const pick = useCallback(
    (value: string) => {
      const kind = picker
      setPicker(null)
      switch (kind) {
        case "model":
          return setModel(value)
        case "agent": {
          setAgent(value)
          const chosen = resolveAgent(agents, value)
          if (chosen.model) setModel(chosen.model)
          return
        }
        case "session":
          return turn.resume(value)
        case "command":
          return dispatch(value, "")
        case "theme":
          return setTheme(loadTheme(value, cwd))
        case "file":
          editor.current?.insert(value)
          return
        default:
          return
      }
    },
    [agents, cwd, dispatch, picker, turn],
  )

  // The permission prompt and the picker own the keyboard while they are open. Everything
  // else is dispatched here first — these handlers run before the focused textarea sees
  // the key, so `stopPropagation` is what keeps the completion strip from also typing.
  useKeyboard((key) => {
    if (turn.permission || picker) return
    const is = (action: Action) => matches(key, keymap[action])

    // Normal-mode keys are commands, not text, so vim gets the first look. It declines
    // anything it does not map — including ctrl chords and everything in insert mode.
    if (vim.handle(key)) return key.stopPropagation()

    if (suggestion) {
      const count = suggestion.choices.length
      if (key.name === "up" || key.name === "down") {
        setSelected((index) => (index + (key.name === "up" ? count - 1 : 1)) % count)
        return key.stopPropagation()
      }
      if (is("acceptSuggestion")) {
        accept()
        return key.stopPropagation()
      }
      if (key.name === "escape") {
        setSuggestion(null)
        return key.stopPropagation()
      }
    }

    if ((key.name === "up" || key.name === "down") && !key.ctrl && !key.meta) {
      if (editor.current?.atEdge(key.name === "up" ? "first" : "last")) {
        recall(key.name === "up" ? -1 : 1)
        return key.stopPropagation()
      }
    }

    if (is("exit")) {
      // A stray ctrl+c should not end the session; the first press only interrupts or warns.
      if (turn.interrupt()) return
      if (quitting) process.exit(0)
      setQuitting(true)
      setTimeout(() => setQuitting(false), QUIT_WINDOW_MS)
    } else if (is("interrupt")) turn.interrupt()
    else if (is("clear")) turn.clear()
    else if (is("palette")) setPicker("command")
    else if (is("modelPicker")) setPicker("model")
    else if (is("agentPicker")) setPicker("agent")
    else if (is("sessionPicker")) setPicker("session")
    else if (is("filePicker")) setPicker("file")
    else if (is("newSession")) turn.newSession()
    else if (is("scrollUp")) scroll.current?.scrollBy({ x: 0, y: -SCROLL_LINES })
    else if (is("scrollDown")) scroll.current?.scrollBy({ x: 0, y: SCROLL_LINES })
    else if (is("scrollHalfUp")) scroll.current?.scrollBy({ x: 0, y: -Math.floor(height / 2) })
    else if (is("scrollHalfDown")) scroll.current?.scrollBy({ x: 0, y: Math.floor(height / 2) })
    else if (is("scrollBottom")) scroll.current?.scrollTo({ x: 0, y: scroll.current.scrollHeight })
  })

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
        <Welcome theme={theme} keymap={keymap} cwd={cwd} branch={branch} model={model} agent={agent} />
        <Messages items={turn.items} theme={theme} motion={motion} streaming={turn.busy} />
      </scrollbox>

      {(turn.busy || turn.compacting) && (
        <Activity items={turn.items} theme={theme} motion={motion} keymap={keymap} compacting={turn.compacting} />
      )}

      {suggestion && !turn.permission && !picker && (
        <Suggestions
          suggestion={suggestion}
          selected={selected}
          theme={theme}
          hint={`${describe(keymap.acceptSuggestion)} complete · ${describe(keymap.submit)} send · esc dismiss`}
        />
      )}

      {turn.permission ? (
        <PermissionPrompt
          request={turn.permission.request}
          theme={theme}
          motion={motion}
          onAnswer={turn.permission.answer}
        />
      ) : picker ? (
        <Picker
          title={PICKER_TITLES[picker]}
          choices={pickerChoices(picker, { config, cwd, agents, commands, files })}
          theme={theme}
          motion={motion}
          onPick={pick}
          onCancel={() => setPicker(null)}
        />
      ) : (
        <Editor
          theme={theme}
          keymap={keymap}
          motion={motion}
          busy={turn.busy}
          handle={editor}
          onSubmit={submit}
          onChange={change}
        />
      )}

      <Status
        theme={theme}
        motion={motion}
        cwd={cwd}
        branch={branch}
        model={model}
        agent={agent}
        usage={turn.usage}
        contextLimit={contextLimit}
        contextTokens={turn.contextTokens}
        vim={vim.mode}
        busy={turn.busy || turn.compacting}
        width={width}
        hint={quitting ? `press ${describe(keymap.exit)} again to exit` : `${describe(keymap.palette)} commands`}
      />
    </box>
  )
}
