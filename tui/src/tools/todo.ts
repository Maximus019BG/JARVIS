import { tool } from "ai"
import { z } from "zod"
import type { ToolContext } from "./context.ts"

/**
 * One list per session, in memory. Deliberately not persisted: a plan is scaffolding for
 * the turn it was made in, and a stale list resurrected from disk is worse than none.
 */
const lists = new Map<string, Todo[]>()

const TodoSchema = z.object({
  text: z.string().describe("What needs doing, in the imperative"),
  status: z.enum(["pending", "in_progress", "done"]),
})

type Todo = z.infer<typeof TodoSchema>

const MARK: Record<Todo["status"], string> = { pending: "☐", in_progress: "◐", done: "☑" }

/** Returned to the model, and shown as-is in the tool card. */
function render(todos: Todo[]): string {
  if (todos.length === 0) return "the list is empty"
  const done = todos.filter((todo) => todo.status === "done").length
  return [`${done}/${todos.length} done`, ...todos.map((todo) => `${MARK[todo.status]} ${todo.text}`)].join("\n")
}

export const todoTool = (ctx: ToolContext) =>
  tool({
    description: [
      "Track the steps of a multi-step task, so nothing is dropped halfway.",
      "Pass the whole list every time — it replaces the previous one. Keep exactly one item `in_progress`.",
      "Call with no arguments to read the current list back.",
      "Skip it for single-step work; a one-item list helps nobody.",
    ].join(" "),
    inputSchema: z.object({
      todos: z.array(TodoSchema).optional().describe("The complete list, replacing what was there"),
    }),
    execute: async ({ todos }) => {
      if (todos) lists.set(ctx.sessionID, todos)
      return render(lists.get(ctx.sessionID) ?? [])
    },
  })

/** Dropped when a session ends so the map cannot grow without bound. */
export function clearTodos(sessionID: string) {
  lists.delete(sessionID)
}
