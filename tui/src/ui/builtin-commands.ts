import { blueprintCommand } from "./blueprint-command.ts"
import { blueprintRoot, listBlueprints } from "../blueprint/store.ts"
import type { Config } from "../config/config.ts"
import { describe, type Keymap } from "../config/keybinds.ts"
import { panelBody, type PanelContent } from "./components/panel.tsx"
import { providerCommand } from "./provider-command.ts"
import { statsCommand } from "./stats-command.ts"
import { tutorialContent } from "./tutorial.ts"
import { expand, type Command } from "../extend/command.ts"
import { summary, type Extensions } from "../extend/extensions.ts"
import type { McpSession } from "../extend/mcp.ts"
import type { PickerKind } from "./pickers.ts"
import type { Turn } from "./use-turn.ts"

/** Every binding, described from the live keymap so it cannot drift from the config. */
export const KEY_HELP: [keyof Keymap, string][] = [
  ["tutorial", "what everything does"],
  ["providerSetup", "set up an AI provider"],
  ["submit", "send"],
  ["newline", "newline"],
  ["acceptSuggestion", "take the / or @ completion"],
  ["interrupt", "interrupt"],
  ["exit", "quit (twice)"],
  ["palette", "commands"],
  ["modelPicker", "model"],
  ["agentPicker", "agent"],
  ["sessionPicker", "sessions"],
  ["filePicker", "insert file path"],
  ["newSession", "new session"],
  ["clear", "clear screen"],
  ["scrollUp", "scroll up a page"],
  ["scrollDown", "scroll down a page"],
  ["scrollHalfUp", "scroll up"],
  ["scrollHalfDown", "scroll down"],
  ["scrollBottom", "jump to newest"],
  ["toggleReasoning", "expand thinking"],
  ["blueprintView", "blueprint pane / fullscreen"],
]

export function help(keymap: Keymap): string {
  const width = Math.max(...KEY_HELP.map(([action]) => describe(keymap[action]).length))
  return [
    "type / for commands, @ for files, and ! to run a shell command",
    "",
    "keys",
    ...KEY_HELP.map(([action, label]) => `  ${describe(keymap[action]).padEnd(width)}  ${label}`),
    "",
    "/provider adds and checks AI providers from here — no file editing, no restart.",
    "jarvis.jsonc is still there for agents, permissions, keybinds and mcp servers.",
    "`jarvis init` scaffolds a .jarvis directory for project agents, commands, skills,",
    "custom tools, plugins and themes. /extensions shows what is loaded.",
  ].join("\n")
}

function mcpReport(mcp: McpSession): string {
  if (mcp.status.length === 0) return "no mcp servers configured"
  return mcp.status
    .map((server) => `${server.server}: ${server.error ? `error — ${server.error}` : `${server.tools} tools`}`)
    .join("\n")
}

function extensionReport(extensions: Extensions): string {
  return [
    summary(extensions),
    ...Object.keys(extensions.tools).map((name) => `tool   ${name}`),
    ...extensions.skills.map((skill) => `skill  ${skill.name} — ${skill.description}`),
    ...extensions.errors.map((error) => `error  ${error}`),
  ].join("\n")
}

export type CommandDeps = {
  turn: Turn
  keymap: Keymap
  mcp: McpSession
  extensions: Extensions
  config: Config
  cwd: string
  /** Terminal columns, so /provider stats can size its bars to the window. */
  width: number
  openPicker: (kind: PickerKind) => void
  /** Shows read-only content in the scrollable overlay. */
  openPanel: (content: PanelContent) => void
  /** Opens the interactive provider setup flow, optionally starting from a known preset. */
  openSetup: (presetID?: string) => void
  /** Opens the pairing flow, or this device's pairing when it already has one. */
  openPair: () => void
  /**
   * Re-reads the config after a command wrote to it. Returns false if the result did not parse,
   * in which case the running session keeps the config it had.
   */
  reload: (changed?: string) => boolean
  /** Runs a connection test and shows the result. Async, so the caller owns the await. */
  testProvider: (id: string) => void
  quit: () => void
}

/**
 * Dispatches one command. Markdown commands become a prompt; built-ins act on the
 * turn or open a picker. A plain function with explicit dependencies, so the whole
 * command table is readable in one place.
 */
export function runCommand(command: Command, args: string, deps: CommandDeps): void {
  const { turn, keymap, mcp, extensions, config, cwd, width, openPicker, openPanel, openSetup, openPair, reload, quit } =
    deps

  if (command.kind === "prompt") {
    turn.send(expand(command, args), { agent: command.agent, model: command.model })
    return
  }

  switch (command.name) {
    case "help":
      return turn.note(help(keymap))
    case "new":
      return turn.newSession()
    case "clear":
      return turn.clear()
    case "compact":
      return turn.compact()
    case "model":
      return openPicker("model")
    case "agent":
      return openPicker("agent")
    case "sessions":
      return openPicker("session")
    case "export":
      return turn.export()
    case "retry":
      return turn.retry(args || undefined)
    case "undo":
      return turn.history("undo")
    case "redo":
      return turn.history("redo")
    case "theme":
      return openPicker("theme")
    case "mcp":
      return turn.note(mcpReport(mcp))
    case "provider": {
      // `/provider` and `/provider setup` open the flow rather than print at it; everything
      // else still answers with a panel. Returning null is how the command says it already
      // took over the screen.
      const content = providerCommand(args, {
        config,
        cwd,
        width: panelBody(width),
        openSetup,
        openPicker: () => openPicker("provider"),
        reload,
        testProvider: deps.testProvider,
      })
      return content ? openPanel(content) : undefined
    }
    case "pair":
      return openPair()
    case "blueprint":
      // Bare `/blueprint` picks one rather than printing names to retype. An empty store
      // still gets the panel — the picker's "no matches" would lose the how-to-make-one hint.
      if (!args.trim() && listBlueprints(blueprintRoot(config)).length > 0) return openPicker("blueprint")
      return openPanel(blueprintCommand(args, { config, width: panelBody(width) }))
    case "stats":
      return openPanel(statsCommand(args, { width: panelBody(width) }))
    case "tutorial":
      return openPanel(tutorialContent(keymap, KEY_HELP, panelBody(width)))
    case "extensions":
      return turn.note(extensionReport(extensions))
    case "exit":
      return quit()
    default:
      return turn.note(`unhandled command /${command.name}`, "error")
  }
}
