import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { tool } from "ai"
import { z } from "zod"
import { IGNORED } from "./glob.ts"
import { displayPath, resolvePath, type ToolContext } from "./context.ts"

const MAX_ENTRIES = 400

export const listTool = (ctx: ToolContext) =>
  tool({
    description: "List the contents of a directory as an indented tree. Skips build output and version control dirs.",
    inputSchema: z.object({
      path: z.string().optional().describe("Directory to list, defaults to the workspace root"),
      depth: z.number().optional().describe("How many levels to descend (default 2)"),
    }),
    execute: async ({ path, depth = 2 }) => {
      const root = path ? resolvePath(ctx, path) : ctx.cwd
      const lines: string[] = []

      const walk = async (dir: string, level: number) => {
        if (level > depth || lines.length >= MAX_ENTRIES) return
        const entries = (await readdir(dir, { withFileTypes: true }))
          .filter((entry) => !IGNORED.has(entry.name) && !entry.name.startsWith("."))
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        for (const entry of entries) {
          if (lines.length >= MAX_ENTRIES) return
          lines.push(`${"  ".repeat(level)}${entry.name}${entry.isDirectory() ? "/" : ""}`)
          if (entry.isDirectory()) await walk(join(dir, entry.name), level + 1)
        }
      }

      await walk(root, 0)
      const header = `${displayPath(ctx, root)}/`
      if (lines.length === 0) return `${header}\n  (empty)`
      const body = lines.length >= MAX_ENTRIES ? `${lines.join("\n")}\n  …(truncated)` : lines.join("\n")
      return `${header}\n${body}`
    },
  })
