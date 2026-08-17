import { tool } from "ai"
import { z } from "zod"
import { displayPath, resolvePath, type ToolContext } from "./context.ts"

const MAX_RESULTS = 200

/** Directories never worth walking; keeps glob and grep from drowning in build output. */
export const IGNORED = new Set([".git", "node_modules", "dist", "build", "out", ".next", "target", ".venv", "coverage"])

export const globTool = (ctx: ToolContext) =>
  tool({
    description: "Find files by glob pattern, e.g. `src/**/*.ts`. Returns paths relative to the workspace root.",
    inputSchema: z.object({
      pattern: z.string().describe("Glob pattern"),
      path: z.string().optional().describe("Directory to search in, defaults to the workspace root"),
    }),
    execute: async ({ pattern, path }) => {
      const root = path ? resolvePath(ctx, path) : ctx.cwd
      const matches: string[] = []
      for await (const match of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true, dot: false })) {
        if (match.split("/").some((segment) => IGNORED.has(segment))) continue
        matches.push(displayPath(ctx, `${root}/${match}`))
        if (matches.length > MAX_RESULTS) break
      }
      if (matches.length === 0) return "no matches"
      matches.sort()
      const shown = matches.slice(0, MAX_RESULTS)
      return matches.length > MAX_RESULTS ? `${shown.join("\n")}\n\n(truncated at ${MAX_RESULTS})` : shown.join("\n")
    },
  })
