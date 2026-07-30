import { tool } from "ai"
import { z } from "zod"
import type { ToolContext } from "./context.ts"

const DEFAULT_TIMEOUT = 120_000
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
      timeout: z.number().optional().describe(`Milliseconds before the command is killed (default ${DEFAULT_TIMEOUT})`),
    }),
    execute: async ({ command, description, timeout = DEFAULT_TIMEOUT }) => {
      await ctx.gate.check({
        tool: "bash",
        title: description ? `${description}` : `run ${command.split("\n")[0]}`,
        detail: command,
        subject: command,
      })

      const proc = Bun.spawn(["bash", "-c", command], {
        cwd: ctx.cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, JARVIS: "1" },
      })
      const timer = setTimeout(() => proc.kill(), timeout)
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const exitCode = await proc.exited
      clearTimeout(timer)

      const clip = (text: string) =>
        text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…(${text.length - MAX_OUTPUT} more bytes)` : text
      const parts = [`exit ${exitCode}`]
      if (stdout.trim()) parts.push(`<stdout>\n${clip(stdout.trimEnd())}\n</stdout>`)
      if (stderr.trim()) parts.push(`<stderr>\n${clip(stderr.trimEnd())}\n</stderr>`)
      return parts.join("\n")
    },
  })
