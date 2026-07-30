import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Config } from "../config/config.ts"
import { ancestors } from "../config/discover.ts"
import { configDir } from "../config/paths.ts"

/** Project instruction files, nearest last so the most specific guidance reads last. */
const INSTRUCTION_NAMES = ["JARVIS.md", "AGENTS.md"]

export const BASE_PROMPT = `You are jarvis, an interactive CLI coding agent. You help with software engineering tasks in the user's workspace.

Be direct and concise. Your output is read in a terminal, so avoid preamble, filler and summaries the user did not ask for. When you finish a task, say what changed in a sentence or two rather than restating the whole diff.

Working style:
- Understand before you change. Read the files you are about to touch and trace how they are used.
- Prefer the smallest change that actually fixes the problem, and fix root causes rather than symptoms.
- Match the surrounding code: its naming, its idioms, its comment density. Do not add libraries the project does not already use without saying so.
- Never invent APIs, file paths or command output. If you have not read it, read it.
- Use the read, glob, grep and list tools instead of shelling out to cat, find or grep.
- Run independent tool calls together in one step rather than one at a time.
- After code changes, run the project's own checks (tests, typecheck, lint) if you can find them.

Refuse only work that is genuinely harmful. Security questions about the user's own code, defensive tooling and authorized testing are ordinary work.`

/** Walks from the project root down to cwd collecting instruction files. */
export function instructionFiles(cwd: string): string[] {
  const found: string[] = []
  const global = join(configDir, "JARVIS.md")
  if (existsSync(global)) found.push(global)
  for (const dir of ancestors(cwd)) {
    for (const name of INSTRUCTION_NAMES) {
      const path = join(dir, name)
      if (existsSync(path)) found.push(path)
    }
  }
  return found
}

function extraInstructions(config: Config, cwd: string): string[] {
  return config.instructions.flatMap((pattern) => {
    const matches = [...new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: true, absolute: true })]
    return matches.length > 0 ? matches : []
  })
}

export type PromptOptions = {
  config: Config
  cwd: string
  /** The agent's own prompt, appended after the base prompt. */
  agentPrompt?: string
}

export function systemPrompt({ config, cwd, agentPrompt }: PromptOptions): string {
  const parts = [BASE_PROMPT]
  if (agentPrompt) parts.push(agentPrompt)

  parts.push(
    [
      "<environment>",
      `working directory: ${cwd}`,
      `platform: ${process.platform}`,
      `today: ${new Date().toISOString().slice(0, 10)}`,
      "</environment>",
    ].join("\n"),
  )

  for (const path of [...instructionFiles(cwd), ...extraInstructions(config, cwd)]) {
    const body = readFileSync(path, "utf8").trim()
    if (body) parts.push(`<instructions source="${path}">\n${body}\n</instructions>`)
  }
  return parts.join("\n\n")
}
