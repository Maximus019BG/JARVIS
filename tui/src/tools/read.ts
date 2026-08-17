import { tool } from "ai"
import { z } from "zod"
import { ToolError, displayPath, markRead, resolvePath, type ToolContext } from "./context.ts"

const MAX_LINES = 2000
const MAX_LINE_LENGTH = 2000

export const readTool = (ctx: ToolContext) =>
  tool({
    description:
      "Read a file from the workspace. Output is line-numbered. Use offset/limit for files too large to read at once.",
    inputSchema: z.object({
      filePath: z.string().describe("Path to the file, absolute or relative to the workspace root"),
      offset: z.number().optional().describe("1-based line to start from"),
      limit: z.number().optional().describe(`Lines to read (default ${MAX_LINES})`),
    }),
    execute: async ({ filePath, offset = 1, limit = MAX_LINES }) => {
      const absolute = resolvePath(ctx, filePath)
      const file = Bun.file(absolute)
      if (!(await file.exists())) throw new ToolError(`file not found: ${displayPath(ctx, absolute)}`)
      const lines = (await file.text()).split("\n")
      await markRead(ctx, absolute)

      const start = Math.max(0, offset - 1)
      const slice = lines.slice(start, start + limit)
      const body = slice
        .map((line, i) => {
          const truncated = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + "…" : line
          return `${String(start + i + 1).padStart(5)}\t${truncated}`
        })
        .join("\n")
      const remaining = lines.length - (start + slice.length)
      return remaining > 0 ? `${body}\n\n(${remaining} more lines)` : body
    },
  })
