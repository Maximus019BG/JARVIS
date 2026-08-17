import { tool } from "ai"
import { z } from "zod"
import { IGNORED } from "./glob.ts"
import { resolvePath, type ToolContext } from "./context.ts"

const MAX_MATCHES = 200

const hasRipgrep = Bun.which("rg") !== null

function command(pattern: string, root: string, include?: string): string[] {
  if (hasRipgrep) {
    const args = ["rg", "--line-number", "--no-heading", "--color=never", "--max-count", "20"]
    if (include) args.push("--glob", include)
    return [...args, "--", pattern, root]
  }
  // grep has no --glob, so `include` becomes --include and ignores are per-directory.
  const args = ["grep", "-rnI"]
  if (include) args.push(`--include=${include}`)
  for (const dir of IGNORED) args.push(`--exclude-dir=${dir}`)
  return [...args, "-e", pattern, root]
}

export const grepTool = (ctx: ToolContext) =>
  tool({
    description: "Search file contents with a regular expression. Returns `path:line:match` for each hit.",
    inputSchema: z.object({
      pattern: z.string().describe("Regular expression to search for"),
      path: z.string().optional().describe("File or directory to search, defaults to the workspace root"),
      include: z.string().optional().describe("Only search files matching this glob, e.g. `*.ts`"),
    }),
    execute: async ({ pattern, path, include }) => {
      const root = path ? resolvePath(ctx, path) : ctx.cwd
      const proc = Bun.spawn(command(pattern, root, include), { cwd: ctx.cwd, stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const exitCode = await proc.exited
      // Both rg and grep exit 1 for "no matches", which is not an error here.
      if (exitCode > 1) return `search failed: ${stderr.trim() || `exit ${exitCode}`}`

      const lines = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => (line.startsWith(ctx.cwd + "/") ? line.slice(ctx.cwd.length + 1) : line))
      if (lines.length === 0) return "no matches"
      const shown = lines.slice(0, MAX_MATCHES)
      return lines.length > MAX_MATCHES
        ? `${shown.join("\n")}\n\n(${lines.length - MAX_MATCHES} more matches)`
        : shown.join("\n")
    },
  })
