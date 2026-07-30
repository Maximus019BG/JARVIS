import { tool } from "ai"
import { createPatch } from "diff"
import { z } from "zod"
import { ToolError, displayPath, resolvePath, type ToolContext } from "./context.ts"

export const editTool = (ctx: ToolContext) =>
  tool({
    description: [
      "Replace an exact string in a file. Read the file first.",
      "`oldString` must match the file byte for byte, including indentation, and must be unique unless `replaceAll` is set.",
    ].join(" "),
    inputSchema: z.object({
      filePath: z.string().describe("Path to the file, absolute or relative to the workspace root"),
      oldString: z.string().describe("Exact text to replace"),
      newString: z.string().describe("Replacement text"),
      replaceAll: z.boolean().optional().describe("Replace every occurrence instead of requiring a unique match"),
    }),
    execute: async ({ filePath, oldString, newString, replaceAll = false }) => {
      const absolute = resolvePath(ctx, filePath)
      const name = displayPath(ctx, absolute)
      const file = Bun.file(absolute)
      if (!(await file.exists())) throw new ToolError(`file not found: ${name}`)
      if (!ctx.read.has(absolute)) throw new ToolError(`read ${name} before editing it`)
      if (oldString === newString) throw new ToolError("oldString and newString are identical")

      const before = await file.text()
      const occurrences = before.split(oldString).length - 1
      if (occurrences === 0) throw new ToolError(`oldString not found in ${name}`)
      if (occurrences > 1 && !replaceAll) {
        throw new ToolError(`oldString appears ${occurrences} times in ${name}; add more context or set replaceAll`)
      }
      const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString)

      await ctx.gate.check({
        tool: "edit",
        title: `edit ${name}`,
        detail: createPatch(name, before, after, "", "", { context: 3 }),
        detailKind: "diff",
        subject: name,
      })

      await Bun.write(absolute, after)
      return `edited ${name} (${occurrences} replacement${occurrences === 1 ? "" : "s"})`
    },
  })
