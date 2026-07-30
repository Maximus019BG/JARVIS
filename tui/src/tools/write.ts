import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { tool } from "ai"
import { z } from "zod"
import { displayPath, resolvePath, type ToolContext } from "./context.ts"

export const writeTool = (ctx: ToolContext) =>
  tool({
    description:
      "Write a file, creating parent directories as needed and overwriting any existing content. Prefer `edit` for changing part of an existing file.",
    inputSchema: z.object({
      filePath: z.string().describe("Path to the file, absolute or relative to the workspace root"),
      content: z.string().describe("Full contents of the file"),
    }),
    execute: async ({ filePath, content }) => {
      const absolute = resolvePath(ctx, filePath)
      const name = displayPath(ctx, absolute)
      const existed = await Bun.file(absolute).exists()

      await ctx.gate.check({
        tool: "write",
        title: `${existed ? "overwrite" : "create"} ${name}`,
        detail: content,
        subject: name,
      })

      await mkdir(dirname(absolute), { recursive: true })
      await Bun.write(absolute, content)
      ctx.read.add(absolute)
      return `${existed ? "overwrote" : "created"} ${name} (${content.split("\n").length} lines)`
    },
  })
