import { tool } from "ai"
import { z } from "zod"
import { ToolError, type ToolContext } from "./context.ts"

/** Subagents may not spawn subagents; one level keeps fan-out and cost bounded. */
export const MAX_DEPTH = 1

export const taskTool = (ctx: ToolContext, agents: { name: string; description: string }[]) =>
  tool({
    description: [
      "Delegate a self-contained piece of work to a subagent with its own context window.",
      "Give it everything it needs in `prompt` — it cannot see this conversation. Available agents:",
      agents.map((a) => `\n- ${a.name}: ${a.description}`).join(""),
    ].join(" "),
    inputSchema: z.object({
      agent: z.string().describe("Name of the agent to run"),
      prompt: z.string().describe("The full, self-contained task for the subagent"),
      description: z.string().describe("Three to five words describing the task"),
    }),
    execute: async ({ agent, prompt }) => {
      if (!ctx.spawn || ctx.depth >= MAX_DEPTH) throw new ToolError("subagents cannot spawn further subagents")
      if (!agents.some((a) => a.name === agent)) {
        throw new ToolError(`unknown agent "${agent}" (available: ${agents.map((a) => a.name).join(", ")})`)
      }
      return await ctx.spawn(agent, prompt)
    },
  })
