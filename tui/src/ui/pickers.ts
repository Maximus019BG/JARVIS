import type { Agent } from "../agent/agent-def.ts"
import { listModels } from "../agent/provider.ts"
import { listSessions } from "../agent/session.ts"
import type { Config } from "../config/config.ts"
import { listThemes } from "../config/theme.ts"
import type { Command } from "../extend/command.ts"
import type { Choice } from "./components/dialog.tsx"

/** Everything the one list-picker component can be pointed at. */
export type PickerKind = "model" | "agent" | "session" | "command" | "theme" | "file"

const FILE_LIMIT = 500

export type PickerContext = {
  config: Config
  cwd: string
  agents: Record<string, Agent>
  commands: Command[]
}

/** Choices for a picker. Pure data, so the component stays presentational. */
export function pickerChoices(kind: PickerKind, { config, cwd, agents, commands }: PickerContext): Choice[] {
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
      return [...new Bun.Glob("**/*").scanSync({ cwd, onlyFiles: true })]
        .filter((path) => !path.includes("node_modules") && !path.startsWith("."))
        .slice(0, FILE_LIMIT)
        .map((path) => ({ value: path, label: path }))
  }
}
