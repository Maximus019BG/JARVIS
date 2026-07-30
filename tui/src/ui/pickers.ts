import type { Agent } from "../agent/agent-def.ts"
import { listModels } from "../agent/provider.ts"
import { listSessions } from "../agent/session.ts"
import type { Config } from "../config/config.ts"
import { listThemes } from "../config/theme.ts"
import type { Command } from "../extend/command.ts"
import type { Choice } from "./components/dialog.tsx"

/** Everything the one list-picker component can be pointed at. */
export type PickerKind = "model" | "agent" | "session" | "command" | "theme" | "file"

export const PICKER_TITLES: Record<PickerKind, string> = {
  model: "Select model",
  agent: "Select agent",
  session: "Resume session",
  command: "Run command",
  theme: "Select theme",
  file: "Insert file path",
}

export type PickerContext = {
  config: Config
  cwd: string
  agents: Record<string, Agent>
  commands: Command[]
  files: string[]
}

/**
 * Tracked and untracked files, minus anything gitignored; a glob outside a repo. Read once
 * per session by the caller, because a synchronous walk of a large tree on every keystroke
 * is a visible stall. The whole list goes to the picker — filtering it is cheap, and a
 * silent cut at N reads as "that is all of them".
 */
export function listFiles(cwd: string): string[] {
  const git = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard"], { cwd, stderr: "ignore" })
  if (git.success) {
    const paths = git.stdout.toString().split("\n").filter(Boolean)
    if (paths.length > 0) return paths
  }
  return [...new Bun.Glob("**/*").scanSync({ cwd, onlyFiles: true })].filter(
    (path) => !path.includes("node_modules") && !path.startsWith("."),
  )
}

/** Choices for a picker. Pure data, so the component stays presentational. */
export function pickerChoices(kind: PickerKind, { config, cwd, agents, commands, files }: PickerContext): Choice[] {
  switch (kind) {
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
      return files.map((path) => ({ value: path, label: path }))
  }
}
