import { tool } from "ai"
import { createPatch } from "diff"
import { z } from "zod"
import { stat } from "node:fs/promises"
import { runChecks } from "./check.ts"
import { ToolError, displayPath, markRead, resolvePath, type ToolContext } from "./context.ts"
import { record } from "./snapshot.ts"

const ReplacementSchema = z.object({
  oldString: z.string().describe("Exact text to replace"),
  newString: z.string().describe("Replacement text"),
  replaceAll: z.boolean().optional().describe("Replace every occurrence instead of requiring a unique match"),
})

type Replacement = z.infer<typeof ReplacementSchema>

/** Applies one replacement, or explains exactly why it cannot be applied. */
function apply(content: string, { oldString, newString, replaceAll = false }: Replacement, name: string): string {
  if (oldString === newString) throw new ToolError("oldString and newString are identical")
  const occurrences = content.split(oldString).length - 1
  if (occurrences === 0) throw new ToolError(`oldString not found in ${name}: ${JSON.stringify(oldString.slice(0, 80))}`)
  if (occurrences > 1 && !replaceAll) {
    throw new ToolError(`oldString appears ${occurrences} times in ${name}; add more context or set replaceAll`)
  }
  return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
}

export const editTool = (ctx: ToolContext) =>
  tool({
    description: [
      "Replace exact strings in a file. Read the file first.",
      "`oldString` must match the file byte for byte, including indentation, and must be unique unless `replaceAll` is set.",
      "Pass `edits` to make several replacements in one call: they apply in order and are approved as a single diff.",
    ].join(" "),
    inputSchema: z
      .object({
        filePath: z.string().describe("Path to the file, absolute or relative to the workspace root"),
        edits: z.array(ReplacementSchema).optional().describe("Several replacements, applied in order"),
      })
      .extend(ReplacementSchema.partial().shape),
    execute: async ({ filePath, edits, oldString, newString, replaceAll }) => {
      const absolute = resolvePath(ctx, filePath)
      const name = displayPath(ctx, absolute)
      const file = Bun.file(absolute)
      if (!(await file.exists())) throw new ToolError(`file not found: ${name}`)

      // Either shape is accepted: one replacement inline, or a list.
      const list: Replacement[] =
        edits && edits.length > 0
          ? edits
          : oldString !== undefined && newString !== undefined
            ? [{ oldString, newString, replaceAll }]
            : []
      if (list.length === 0) throw new ToolError("pass either oldString/newString or a non-empty edits array")

      const seen = ctx.read.get(absolute)
      if (seen === undefined) throw new ToolError(`read ${name} before editing it`)
      // Someone edited the file since we read it. Replacing against stale content would
      // silently drop their change, so make the model re-read instead.
      if ((await stat(absolute)).mtimeMs !== seen) {
        throw new ToolError(`${name} changed on disk since you read it; read it again before editing`)
      }

      const before = await file.text()
      let after = before
      for (const edit of list) after = apply(after, edit, name)

      // One prompt for the whole set: approving edits one at a time tells the user less,
      // because they never see the combined result they are actually agreeing to.
      await ctx.gate.check({
        tool: "edit",
        title: list.length > 1 ? `edit ${name} (${list.length} changes)` : `edit ${name}`,
        detail: createPatch(name, before, after, "", "", { context: 3 }),
        detailKind: "diff",
        subject: name,
      })

      record(ctx.sessionID, absolute)
      await Bun.write(absolute, after)
      await markRead(ctx, absolute)
      const summary = `edited ${name} (${list.length} change${list.length === 1 ? "" : "s"})`
      return summary + (await runChecks(ctx, absolute))
    },
  })
