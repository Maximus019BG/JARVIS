import { findProjects } from "../code/project.ts"
import { CODE_ACTIONS, codeAction, type CodeAction } from "../code/tools.ts"

const USAGE =
  "/code new <name> · init · list · status [name] · push [name] [remote] · pull [name] [remote] · clone <name>"

/**
 * `/code push demo origin`, `/code push origin`, `/code push`. A word that names a project
 * here is the project; anything else is a git remote. Results arrive as notes, since every
 * action but `list` may go over the network.
 */
export function codeCommand(args: string, cwd: string, note: (text: string, level?: "info" | "error") => void): void {
  const [word = "list", ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (!(CODE_ACTIONS as readonly string[]).includes(word)) return note(USAGE, "error")
  const action = word as CodeAction
  const takesName = action === "new" || action === "clone" || action === "init"
  const names = new Set(findProjects(cwd).map((project) => project.name))
  let name: string | undefined
  let target: string | undefined
  for (const token of rest) {
    if (!name && (takesName || names.has(token))) name = token
    else target ??= token
  }
  void codeAction(cwd, { action, name, target }).then(
    (text) => note(text),
    (error: unknown) => note(error instanceof Error ? error.message : String(error), "error"),
  )
}
