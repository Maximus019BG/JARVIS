import { run, type AgentEvent } from "../agent/agent.ts"
import { compactSession, isOverflow } from "../agent/compact.ts"
import { appendMessages, openSession } from "../agent/session.ts"
import type { Config } from "../config/config.ts"
import { loadExtensions } from "../extend/extensions.ts"
import { startMcp } from "../extend/mcp.ts"
import { constantAsker, PermissionGate } from "../permission.ts"

export type HeadlessOptions = {
  config: Config
  prompt: string
  model?: string
  agent?: string
  /** Approve every permission request. Without it, tools that need approval fail. */
  yes: boolean
  /** Continue a specific session, as `--session`. */
  session?: string
  /** Continue the most recent session in `cwd`, as `--continue`. */
  resume?: boolean
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
  // Persisted like an interactive turn, so `jarvis run` twice with -c continues a
  // conversation instead of starting over, and the TUI can pick the session up later.
  const session = openSession(cwd, { id: options.session, resume: options.resume })
  appendMessages(session, [{ role: "user", content: options.prompt }])

  const [extensions, mcp] = await Promise.all([loadExtensions(options.config, cwd), startMcp(options.config)])
  for (const error of [...extensions.errors, ...mcp.status.filter((s) => s.error).map((s) => `mcp ${s.server}: ${s.error}`)]) {
    process.stderr.write(`warning: ${error}\n`)
  }

  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.on("SIGINT", onSigint)
  try {
    // Reads `session.messages` on each call, so the retry below sends the compacted history.
    const attempt = () =>
      run({
        config: options.config,
        cwd,
        messages: session.messages,
        agent: options.agent,
        model: options.model,
        gate: new PermissionGate(options.config.permission, constantAsker(options.yes)),
        extraTools: mcp.tools,
        extensions,
        sessionID: session.id,
        abort: controller.signal,
        onEvent: (event) => print(event),
      })

    let result
    try {
      result = await attempt()
    } catch (error) {
      // Unattended runs go many steps deep and are the likeliest to fill the window, with
      // nobody watching to type /compact.
      if (controller.signal.aborted || !isOverflow(error)) throw error
      process.stderr.write("context window exceeded — compacting and retrying\n")
      const { dropped } = await compactSession(options.config, session)
      process.stderr.write(`compacted ${dropped} messages\n`)
      result = await attempt()
    }
    appendMessages(session, result.messages)
    process.stdout.write("\n")
    const { input, output, cost } = result.usage
    process.stderr.write(`\n${input} in / ${output} out${cost > 0 ? ` / $${cost.toFixed(4)}` : ""}\n`)
  } finally {
    process.off("SIGINT", onSigint)
    await mcp.close()
  }
}
