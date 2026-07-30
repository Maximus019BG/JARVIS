import type { ModelMessage } from "ai"
import { run, type AgentEvent } from "./agent.ts"
import type { Config } from "./config.ts"
import { loadExtensions } from "./extensions.ts"
import { startMcp } from "./mcp.ts"
import { constantAsker, PermissionGate } from "./permission.ts"

export type HeadlessOptions = {
  config: Config
  prompt: string
  model?: string
  agent?: string
  /** Approve every permission request. Without it, tools that need approval fail. */
  yes: boolean
  cwd?: string
}

/** Renders agent events as plain lines for non-interactive use and piping. */
function print(event: AgentEvent, prefix = "") {
  switch (event.type) {
    case "text":
      process.stdout.write(event.text)
      break
    case "tool-start":
      process.stderr.write(`${prefix}· ${event.name} ${JSON.stringify(event.input).slice(0, 160)}\n`)
      break
    case "tool-end":
      if (event.failed) process.stderr.write(`${prefix}✗ ${event.name}: ${event.output.split("\n")[0]}\n`)
      break
    case "sub":
      print(event.event, `${prefix}  ${event.agent} `)
      break
    case "error":
      process.stderr.write(`${prefix}error: ${event.message}\n`)
      break
    default:
      break
  }
}

export async function runHeadless(options: HeadlessOptions) {
  if (!options.prompt.trim()) throw new Error("nothing to do — pass a prompt, e.g. jarvis run 'fix the build'")
  const cwd = options.cwd ?? process.cwd()
  const messages: ModelMessage[] = [{ role: "user", content: options.prompt }]

  const [extensions, mcp] = await Promise.all([loadExtensions(options.config, cwd), startMcp(options.config)])
  for (const error of [...extensions.errors, ...mcp.status.filter((s) => s.error).map((s) => `mcp ${s.server}: ${s.error}`)]) {
    process.stderr.write(`warning: ${error}\n`)
  }

  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.on("SIGINT", onSigint)
  try {
    const result = await run({
      config: options.config,
      cwd,
      messages,
      agent: options.agent,
      model: options.model,
      gate: new PermissionGate(options.config.permission, constantAsker(options.yes)),
      extraTools: mcp.tools,
      extensions,
      abort: controller.signal,
      onEvent: (event) => print(event),
    })
    process.stdout.write("\n")
    const { input, output, cost } = result.usage
    process.stderr.write(`\n${input} in / ${output} out${cost > 0 ? ` / $${cost.toFixed(4)}` : ""}\n`)
  } finally {
    process.off("SIGINT", onSigint)
    await mcp.close()
  }
}
