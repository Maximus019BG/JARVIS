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
import { PermissionPrompt, Picker } from "./components/dialog.tsx"
import { Editor, type EditorHandle } from "./components/editor.tsx"
import { Messages } from "./components/messages.tsx"
import { Status } from "./components/status.tsx"
import { pickerChoices, type PickerKind } from "./pickers.ts"
import { useTurn } from "./use-turn.ts"

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

const SCROLL_LINES = 10

export function App({ config, cwd, mcp, extensions, keymap, notes, ...initial }: AppProps) {
  const { width } = useTerminalDimensions()
  const agents = useMemo(() => loadAgents(config, cwd), [config, cwd])
  const commands = useMemo(() => loadCommands(cwd), [cwd])

  const [theme, setTheme] = useState(initial.theme)
  const [agent, setAgent] = useState(initial.agent ?? DEFAULT_AGENT)
  const [model, setModel] = useState(
    // No providers configured is a valid first-run state; the note in the transcript
    // explains it, so show a placeholder instead of refusing to start.
    () => initial.model ?? agents[initial.agent ?? DEFAULT_AGENT]?.model ?? listModels(config)[0]?.id ?? "no model",
  )
  const [picker, setPicker] = useState<PickerKind | null>(null)

  const turn = useTurn({ config, cwd, extensions, mcpTools: mcp.tools, session: initial.session, notes, agent, model })
  const editor = useRef<EditorHandle>(null)
  const scroll = useRef<ScrollBoxRenderable>(null)

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

  const submit = useCallback(
    (text: string) => {
      const parsed = parseCommandLine(text)
      if (parsed) dispatch(parsed.name, parsed.args)
      else turn.send(text)
    },
    [dispatch, turn],
  )

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

  // The permission prompt and the picker own the keyboard while they are open.
  useKeyboard((key) => {
    if (turn.permission || picker) return
    const is = (action: Action) => matches(key, keymap[action])
    if (is("exit")) {
      if (!turn.interrupt()) process.exit(0)
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
        <Messages items={turn.items} theme={theme} streaming={turn.busy} />
      </scrollbox>

      {turn.permission ? (
        <PermissionPrompt request={turn.permission.request} theme={theme} onAnswer={turn.permission.answer} />
      ) : picker ? (
        <Picker
          title={picker}
          choices={pickerChoices(picker, { config, cwd, agents, commands })}
          theme={theme}
          onPick={pick}
          onCancel={() => setPicker(null)}
        />
      ) : (
        <Editor theme={theme} keymap={keymap} busy={turn.busy} handle={editor} onSubmit={submit} />
      )}

      <Status
        theme={theme}
        cwd={cwd}
        model={model}
        agent={agent}
        usage={turn.usage}
        busy={turn.busy}
        hint={width > 90 ? `${describe(keymap.palette)} commands` : undefined}
      />
    </box>
  )
}
