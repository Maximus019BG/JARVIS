import { tool } from "ai"
import { z } from "zod"
import { ToolError, type ToolContext } from "./context.ts"

/**
 * Multiple choice only. Free text is what ending a turn is for — the user is already
 * looking at a prompt — so the only thing worth a modal is the question whose answer is
 * one of a few known options and which would otherwise be guessed silently.
 */
export const askTool = (ctx: ToolContext) =>
  tool({
    description: [
      "Ask the user a multiple-choice question and wait for their answer.",
      "Use it when a choice would change the work materially and you cannot settle it from the request or the files:",
      "units, a standard to follow, which of two readings of an ambiguous requirement is meant.",
      "Do not use it for things you can decide yourself, for confirmation of work already agreed,",
      "or for anything you could answer by reading the code. One question per call.",
    ].join(" "),
    inputSchema: z.object({
      question: z.string().describe("The question, as one clear sentence"),
      options: z
        .array(z.string())
        .min(2)
        .max(6)
        .describe("The answers to choose between. Short and distinct; put the one you would pick first"),
    }),
    execute: async ({ question, options }) => {
      const answer = await ctx.ask!(question, options)
      // Escape means "stop asking and get on with it", not "retry". Saying so in the error
      // is what stops the model asking the same question again on the next step.
      if (!answer) {
        throw new ToolError("the user dismissed the question — proceed with your best assumption and say what you assumed")
      }
      return answer
    },
  })
