import type { Command } from "../extend/command.ts"
import type { Choice } from "./components/dialog.tsx"

/** What the buffer is currently asking for, and the exact text to replace on accept. */
export type Suggestion = { kind: "command" | "file"; token: string; choices: Choice[] }

const MAX = 5

/** Substring matches on the value, prefix matches first, capped so the strip stays small. */
function rank(query: string, choices: Choice[]): Choice[] {
  const needle = query.toLowerCase()
  const hit = (choice: Choice) => choice.value.toLowerCase()
  return choices
    .filter((choice) => hit(choice).includes(needle))
    .sort((a, b) => Number(hit(b).startsWith(needle)) - Number(hit(a).startsWith(needle)))
    .slice(0, MAX)
}

/**
 * `/name` at the start of the buffer offers commands, `@path` anywhere offers files.
 * Anything else suggests nothing, so the strip stays out of the way while writing prose.
 */
export function suggest(text: string, commands: Command[], files: string[]): Suggestion | undefined {
  const command = /^\/(\S*)$/.exec(text)
  if (command) {
    const choices = commands.map((entry) => ({ value: entry.name, label: `/${entry.name}`, hint: entry.description }))
    return { kind: "command", token: command[0], choices: rank(command[1]!, choices) }
  }

  const file = /(?:^|\s)(@\S*)$/.exec(text)
  if (file) {
    const token = file[1]!
    return { kind: "file", token, choices: rank(token.slice(1), files.map((path) => ({ value: path, label: path }))) }
  }

  return undefined
}

/**
 * The text that replaces the token when a choice is taken. Commands complete to their
 * displayed `/name`, files to the bare path — the `@` was only the trigger.
 */
export function completion(suggestion: Suggestion, index: number): string | undefined {
  const choice = suggestion.choices[index]
  if (!choice) return undefined
  return suggestion.kind === "command" ? choice.label : choice.value
}
