import { describe, type Keymap } from "../config/keybinds.ts"
import { expand, type Command } from "../extend/command.ts"
import { summary, type Extensions } from "../extend/extensions.ts"
import type { McpSession } from "../extend/mcp.ts"
import type { PickerKind } from "./pickers.ts"
import type { Turn } from "./use-turn.ts"

/** Every binding, described from the live keymap so it cannot drift from the config. */
const KEY_HELP: [keyof Keymap, string][] = [
  ["submit", "send"],
  ["newline", "newline"],
  ["acceptSuggestion", "take the / or @ completion"],
  ["interrupt", "interrupt"],
  ["exit", "quit (twice when idle)"],
  ["palette", "commands"],
  ["modelPicker", "model"],
  ["agentPicker", "agent"],
  ["sessionPicker", "sessions"],
  ["filePicker", "insert file path"],
  ["newSession", "new session"],
  ["clear", "clear screen"],
  ["scrollHalfUp", "scroll up"],
  ["scrollHalfDown", "scroll down"],
  ["scrollBottom", "jump to newest"],
]

export function help(keymap: Keymap): string {
  const width = Math.max(...KEY_HELP.map(([action]) => describe(keymap[action]).length))
  return [
    "type / for commands and @ for files",
    "",
    "keys",
    ...KEY_HELP.map(([action, label]) => `  ${describe(keymap[action]).padEnd(width)}  ${label}`),
    "",
    "jarvis.jsonc configures providers, agents, permissions, keybinds and mcp servers.",
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
  openPicker: (kind: PickerKind) => void
  quit: () => void
}

/**
 * Dispatches one command. Markdown commands become a prompt; built-ins act on the
 * turn or open a picker. A plain function with explicit dependencies, so the whole
 * command table is readable in one place.
 */
export function runCommand(command: Command, args: string, deps: CommandDeps): void {
  const { turn, keymap, mcp, extensions, openPicker, quit } = deps

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
    case "model":
      return openPicker("model")
    case "agent":
      return openPicker("agent")
    case "sessions":
      return openPicker("session")
    case "theme":
      return openPicker("theme")
    case "mcp":
      return turn.note(mcpReport(mcp))
    case "extensions":
      return turn.note(extensionReport(extensions))
    case "exit":
      return quit()
    default:
      return turn.note(`unhandled command /${command.name}`, "error")
  }
}
