import { tool } from "ai"
import { z } from "zod"
import { startBackground } from "./background.ts"
import { clip, type ToolContext } from "./context.ts"

const DEFAULT_TIMEOUT = 120_000
/** The model picks `timeout`; this caps it, so a runaway number can't park a turn for hours. */
const MAX_TIMEOUT = 600_000
const MAX_OUTPUT = 60_000

export const bashTool = (ctx: ToolContext) =>
  tool({
    description: [
      "Run a shell command in the workspace root.",
      "Prefer the dedicated read/glob/grep tools over cat/find/grep — they are cheaper and produce better output.",
    ].join(" "),
    inputSchema: z.object({
      command: z.string().describe("Command to run, executed with bash -c"),
      description: z.string().optional().describe("Short description of what the command does"),
      timeout: z
        .number()
        .optional()
        .describe(`Milliseconds before the command is killed (default ${DEFAULT_TIMEOUT}, max ${MAX_TIMEOUT})`),
      background: z
        .boolean()
        .optional()
        .describe("Start it and return immediately. Use for dev servers, watchers and anything that does not exit."),
    }),
    execute: async ({ command, description, timeout = DEFAULT_TIMEOUT, background = false }, { abortSignal }) => {
      await ctx.gate.check({
        tool: "bash",
        title: description ? `${description}` : `run ${command.split("\n")[0]}`,
        detail: command,
        subject: command,
      })

      if (background) {
        const id = startBackground(ctx, command)
        return `started ${id} in the background; read its output with bash_output id=${id}`
      }

      // Its own process group, so a timeout or Esc kills what the command started (a test
      // runner's workers, a pipeline) and not just bash, which would leave them running.
      const proc = Bun.spawn(["bash", "-c", command], {
        cwd: ctx.cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, JARVIS: "1" },
        detached: true,
      })
      const kill = () => {
        try {
          process.kill(-proc.pid, "SIGKILL")
        } catch {
          proc.kill("SIGKILL") // the group is already gone
        }
      }
      const timer = setTimeout(kill, Math.min(timeout, MAX_TIMEOUT))
      abortSignal?.addEventListener("abort", kill, { once: true })
      // ponytail: output is buffered whole and clipped after; stream-and-cap if a command's output ever OOMs.
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const exitCode = await proc.exited
      clearTimeout(timer)
      abortSignal?.removeEventListener("abort", kill)

      const parts = [`exit ${exitCode}`]
      if (stdout.trim()) parts.push(`<stdout>\n${clip(stdout.trimEnd(), MAX_OUTPUT)}\n</stdout>`)
      if (stderr.trim()) parts.push(`<stderr>\n${clip(stderr.trimEnd(), MAX_OUTPUT)}\n</stderr>`)
      return parts.join("\n")
    },
  })
