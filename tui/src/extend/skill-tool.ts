import { tool } from "ai"
import { z } from "zod"
import { skillFiles, type Skill } from "./skill.ts"
import { ToolError, type ToolContext } from "../tools/context.ts"

/**
 * One tool for every skill, so the context window only carries names and one-line
 * descriptions until the model actually asks for a skill's instructions.
 */
export const skillTool = (ctx: ToolContext, skills: Skill[]) =>
  tool({
    description: [
      "Load the full instructions for a skill. Call this before doing the kind of work a skill covers.",
      "Available skills:",
      ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    ].join("\n"),
    inputSchema: z.object({ name: z.string().describe("Name of the skill to load") }),
    execute: async ({ name }) => {
      const skill = skills.find((entry) => entry.name === name)
      if (!skill) throw new ToolError(`unknown skill "${name}" (available: ${skills.map((s) => s.name).join(", ")})`)

      await ctx.gate.check({ tool: "skill", title: `load skill ${name}`, detail: skill.description, subject: name })

      const files = skillFiles(skill)
      const footer = files.length > 0 ? `\n\nFiles in ${skill.dir}:\n${files.map((f) => `- ${f}`).join("\n")}` : ""
      return `${skill.body}${footer}`
    },
  })
