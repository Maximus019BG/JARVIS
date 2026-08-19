import { readFileSync } from "node:fs"
import { basename } from "node:path"
import matter from "gray-matter"
import { resourceFiles } from "../config/discover.ts"

/** Built-ins are handled by the UI; markdown ones expand into a user message. */
export type Command =
  | { name: string; description: string; kind: "builtin" }
  | { name: string; description: string; kind: "prompt"; template: string; agent?: string; model?: string }

export const BUILTIN_COMMANDS: Command[] = [
  { name: "help", description: "Show keybindings and commands", kind: "builtin" },
  { name: "new", description: "Start a new session", kind: "builtin" },
  { name: "clear", description: "Clear the transcript on screen", kind: "builtin" },
  { name: "compact", description: "Summarize the history to free up context", kind: "builtin" },
  { name: "model", description: "Pick the model", kind: "builtin" },
  { name: "agent", description: "Pick the agent", kind: "builtin" },
  { name: "sessions", description: "Resume an earlier session", kind: "builtin" },
  { name: "export", description: "Write the full session to a markdown file", kind: "builtin" },
  { name: "retry", description: "Send the last prompt again — /retry <provider/model> to switch", kind: "builtin" },
  { name: "undo", description: "Revert the file changes from the last turn", kind: "builtin" },
  { name: "redo", description: "Re-apply the changes that /undo reverted", kind: "builtin" },
  { name: "theme", description: "Pick the color theme", kind: "builtin" },
  { name: "blueprint", description: "Show blueprints — /blueprint <name> to see one", kind: "builtin" },
  { name: "pair", description: "Pair this device with the JARVIS cloud, or unpair it", kind: "builtin" },
  { name: "mcp", description: "Show MCP server status", kind: "builtin" },
  {
    name: "provider",
    description: "Add, check and manage AI providers — /provider test <id>, /provider stats",
    kind: "builtin",
  },
  { name: "stats", description: "Spend and tokens by model, agent and session — /stats <days>", kind: "builtin" },
  { name: "tutorial", description: "Show what everything on screen does", kind: "builtin" },
  { name: "extensions", description: "Show loaded custom tools, skills and plugins", kind: "builtin" },
  { name: "exit", description: "Quit jarvis", kind: "builtin" },
]

/** `.jarvis/commands/review.md` becomes `/review`; `$ARGUMENTS` takes the rest of the line. */
export function loadCommands(cwd: string): Command[] {
  const commands = new Map(BUILTIN_COMMANDS.map((command) => [command.name, command]))
  for (const path of resourceFiles(cwd, "commands", ".md")) {
    const parsed = matter(readFileSync(path, "utf8"))
    const data = parsed.data as { description?: string; agent?: string; model?: string }
    const name = basename(path, ".md")
    commands.set(name, {
      name,
      description: data.description ?? `run the ${name} command`,
      kind: "prompt",
      template: parsed.content.trim(),
      agent: data.agent,
      model: data.model,
    })
  }
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Splits `"/review src/app.ts"` into the command name and its arguments. */
export function parseCommandLine(input: string): { name: string; args: string } | undefined {
  if (!input.startsWith("/")) return undefined
  const match = /^\/(\S*)\s*([\s\S]*)$/.exec(input)
  return match ? { name: match[1]!, args: match[2]!.trim() } : undefined
}

export function expand(command: Extract<Command, { kind: "prompt" }>, args: string): string {
  return command.template.includes("$ARGUMENTS")
    ? command.template.replaceAll("$ARGUMENTS", args)
    : [command.template, args].filter(Boolean).join("\n\n")
}
