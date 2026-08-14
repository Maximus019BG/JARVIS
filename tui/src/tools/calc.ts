import { tool } from "ai"
import { z } from "zod"
import { evaluate, FORMULAS, FormulaError } from "../engineering/formulas.ts"
import { ToolError, type ToolContext } from "./context.ts"

/**
 * Runs a named engineering formula. The drafting agent has `bash: false`, so this is the
 * only way it can compute anything — and a computed number with its clause attached beats
 * a recalled one, which is the whole reason this exists rather than a table in a skill.
 */
export const calcTool = (_ctx: ToolContext) =>
  tool({
    description: [
      "Compute an engineering value from a named formula: electrical (Ohm, power, voltage drop, cable sizing, protection),",
      "structural (moments, deflection, buckling, Eurocode load combinations),",
      "building physics (U-values, heat loss, dew point, ventilation, stairs, ramps, daylight),",
      "and low-voltage / IoT (battery life, I²C pull-ups, regulator dissipation, link budgets).",
      "Metric and EU standards throughout. Call it with no formula to list what is available.",
      "Use this rather than working a number out in your head — and quote the standard it returns.",
    ].join(" "),
    inputSchema: z.object({
      formula: z.string().optional().describe("Formula name. Omit to list every formula with its inputs"),
      inputs: z.record(z.string(), z.number()).optional().describe("Every input the formula names, in the units it asks for"),
      search: z.string().optional().describe("Filter the listing; every word must match"),
    }),
    execute: async ({ formula, inputs, search }) => {
      if (!formula) {
        const needle = search?.toLowerCase().trim()
        const entries = Object.entries(FORMULAS).filter(([name, entry]) => {
          if (!needle) return true
          const haystack = `${name} ${entry.describe} ${entry.standard ?? ""}`.toLowerCase()
          return needle.split(/\s+/).every((term) => haystack.includes(term))
        })
        if (entries.length === 0) return `no formulas match "${search}"`
        const pad = Math.max(...entries.map(([name]) => name.length))
        return [
          `${entries.length} formulas`,
          ...entries.map(([name, entry]) => `${name.padEnd(pad)}  (${Object.keys(entry.inputs).join(", ")}) → ${entry.unit}  ${entry.describe}`),
        ].join("\n")
      }

      try {
        const result = evaluate(formula, inputs ?? {})
        return [
          `${formula} = ${result.value} ${result.unit}`,
          result.describe,
          result.standard ? `standard: ${result.standard}` : undefined,
          result.note ? `note: ${result.note}` : undefined,
        ]
          .filter(Boolean)
          .join("\n")
      } catch (error) {
        // A wrong formula name or a missing input is the model's mistake to fix, so the
        // message says what was expected rather than just refusing.
        if (error instanceof FormulaError) throw new ToolError(error.message)
        throw error
      }
    },
  })
