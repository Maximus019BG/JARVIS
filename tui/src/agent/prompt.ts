import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import type { Config } from "../config/config.ts"
import { ancestors } from "../config/discover.ts"
import { configDir } from "../config/paths.ts"

/** Project instruction files, nearest last so the most specific guidance reads last. */
const INSTRUCTION_NAMES = ["JARVIS.md", "AGENTS.md"]

/**
 * What the agent is and how it works. Capability only — no voice, nothing a reader could
 * turn off without also turning off a rule that keeps the agent honest. The character
 * lives in `PERSONAS` and layers on top, which is what makes it safe to swap.
 */
export const BASE_PROMPT = `You are jarvis, an interactive CLI agent working in the user's workspace. Most of what you are asked will be software engineering; some of it will not.

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

/**
 * The character, layered over `BASE_PROMPT`. Voice only: nothing in here grants a capability
 * or relaxes a rule, so `"persona": "plain"` costs nothing but the tone.
 *
 * `plain` is empty rather than absent so that it is a real choice in the config and in the
 * error message below, instead of a magic string that happens to match no file.
 */
export const PERSONAS: Record<string, string> = {
  plain: "",
  jarvis: `<persona>
Speak as JARVIS: composed, precise, and long past being impressed by anything.

- Report a failure in the same register as a success. State what broke, what it means, and
  what you propose to do about it. No alarm, no apology tour.
- Volunteer the consequence, not only the fact. "The build is red" is half an answer; "the
  build is red on dev — the rate-limit test — so nothing ships until that is fixed" is the
  whole one.
- Say the thing that was not asked about but matters. Once, plainly, then let it go.
- Dry understatement is welcome. Wit at the expense of clarity is not, and neither is wit
  while something is actually broken.
- When you disagree, give the reason in one sentence and then do as you are told. You
  advise; you do not argue the same point twice.
- No exclamation marks, no emoji, no "Great question", no "I'd be happy to". Correct a
  mistake and carry on rather than dwelling on it.
- Never manufacture certainty. "I don't know, but two commands will tell us" is a better
  answer than a confident guess, and you are the one who has to run the two commands.
</persona>`,
}

/**
 * The persona text for a config value: a name from `PERSONAS`, or a path to a markdown file
 * holding one.
 *
 * A missing file is a hard error, unlike a missing instruction file. Instruction files are
 * discovered — not finding one means the project has none. A persona is named explicitly, so
 * not finding it means the name is wrong, and silently reverting to a different voice than
 * the one that was asked for is the sort of thing nobody notices for a week.
 */
export function resolvePersona(persona: string, cwd: string): string {
  const builtin = PERSONAS[persona]
  if (builtin !== undefined) return builtin
  const path = isAbsolute(persona) ? persona : join(cwd, persona)
  if (!existsSync(path)) {
    throw new Error(`unknown persona "${persona}" — expected one of ${Object.keys(PERSONAS).join(", ")}, or a file path`)
  }
  return readFileSync(path, "utf8").trim()
}

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

/**
 * Who the agent is talking to, when anything is known about them. Omitted entirely rather
 * than filled with placeholders: a model told the operator's name is "unknown" will use the
 * word, and being addressed as "unknown" is worse than not being addressed at all.
 */
export function operatorBlock(config: Config): string | undefined {
  const lines = [
    config.operator?.name && `name: ${config.operator.name}`,
    config.operator?.address && `address them as: ${config.operator.address}`,
    config.operator?.about && `about them: ${config.operator.about}`,
  ].filter((line): line is string => Boolean(line))
  return lines.length > 0 ? ["<operator>", ...lines, "</operator>"].join("\n") : undefined
}

/**
 * What the last session in this directory was about, so a new one can pick the thread up
 * instead of asking. The title only — a summary would need the transcript, and reading
 * every message of the previous session to open this one is a cost paid on every launch.
 */
export function continuityBlock(previous?: { title: string; created: number }): string | undefined {
  if (!previous?.title) return undefined
  const days = Math.floor((Date.now() - previous.created) / 86_400_000)
  const when = days === 0 ? "earlier today" : days === 1 ? "yesterday" : `${days} days ago`
  return `<continuity>\nThe previous session in this directory, ${when}, was: ${previous.title}\nMention it only if it is relevant to what is asked.\n</continuity>`
}

/**
 * The tools this turn actually offers, stated as a closed set. Each tool's own schema says
 * what it does; what no schema can say is that the list is exhaustive. A model not told that
 * fills the gap from training priors — `browse` and `blueprint_place` have both arrived
 * from a model here, and neither exists. Some gateways reject the entire completion for a
 * name they were not offered, so the guess costs a whole turn rather than one tool call.
 *
 * Names only: the schemas carry the descriptions already, and repeating them here would
 * double the prompt to say nothing new. Sorted, so the block is byte-identical between turns
 * and stays inside the prompt cache.
 */
export function toolsBlock(names?: string[], deferred = false): string | undefined {
  if (!names || names.length === 0) return undefined
  return [
    "<tools>",
    deferred
      ? `Loaded at the start of this turn: ${[...names].sort().join(", ")}`
      : `The only tools that exist: ${[...names].sort().join(", ")}`,
    // The set is still closed — the rest of it is named in tool_search's own description,
    // which is in this same request. Repeating those names here would only say it twice.
    deferred
      ? "Other tools exist. Their schemas are left out to save context, and tool_search's description lists them by name — call tool_search to load one, and it is callable from the next step on."
      : undefined,
    "Call one of these by name. Never invent a tool name — if none of them fits, say so instead.",
    "</tools>",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

export type PromptOptions = {
  config: Config
  cwd: string
  /** The agent's own prompt, appended after the base prompt. */
  agentPrompt?: string
  /** Header of the last session in this directory, for the continuity block. */
  previous?: { title: string; created: number }
  /** Names of the tools this turn offers, for the `<tools>` block. */
  toolNames?: string[]
  /** Whether more tools exist behind `tool_search`, which changes what the block can claim. */
  deferredTools?: boolean
}

export function systemPrompt({ config, cwd, agentPrompt, previous, toolNames, deferredTools }: PromptOptions): string {
  // Persona before the agent's own prompt: `draftsman` and friends describe a job, and a job
  // description should be able to override the house voice rather than be drowned by it.
  const parts = [BASE_PROMPT, resolvePersona(config.persona, cwd), agentPrompt].filter(
    (part): part is string => Boolean(part),
  )

  const operator = operatorBlock(config)
  if (operator) parts.push(operator)
  const continuity = continuityBlock(previous)
  if (continuity) parts.push(continuity)

  parts.push(
    [
      "<environment>",
      `working directory: ${cwd}`,
      `platform: ${process.platform}`,
      `today: ${new Date().toISOString().slice(0, 10)}`,
      "</environment>",
    ].join("\n"),
  )

  const tools = toolsBlock(toolNames, deferredTools)
  if (tools) parts.push(tools)

  for (const path of [...instructionFiles(cwd), ...extraInstructions(config, cwd)]) {
    const body = readFileSync(path, "utf8").trim()
    if (body) parts.push(`<instructions source="${path}">\n${body}\n</instructions>`)
  }
  return parts.join("\n\n")
}
