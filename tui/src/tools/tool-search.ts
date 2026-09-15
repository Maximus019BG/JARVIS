import { tool } from "ai"
import { z } from "zod"
import type { Loadout } from "./loadout.ts"

/**
 * Loads a tool the request did not carry.
 *
 * The catalog in the description costs about twenty tokens a tool; the schemas it stands in
 * for cost between sixty and two thousand each. That is the whole trade. `skill` makes the
 * same one for instructions, and this is its sibling — names and a line up front, the
 * expensive part on demand.
 *
 * Deliberately ungated: it reveals a schema, it does not act. The tool it loads is gated as
 * it always was, when the model actually calls it.
 */
export const toolSearchTool = (loadout: Loadout) =>
  tool({
    description: [
      "Load a tool that is not currently available. The tools below exist, but their schemas are",
      "left out of the request to save context, so you cannot call them until you load them here.",
      "Pass `names` when you know what you want, `query` when you do not. Loading is cheap and",
      "several can be loaded at once; a loaded tool stays loaded for the rest of the conversation.",
      "",
      "Loadable tools:",
      loadout.catalog(),
    ].join("\n"),
    inputSchema: z.object({
      names: z.array(z.string()).optional().describe("Exact tool names to load"),
      query: z.string().optional().describe("Search text, when the exact name is not known"),
    }),
    execute: async ({ names = [], query }) => {
      const wanted = [...names, ...(query ? [query] : [])]
      const loaded = loadout.load(wanted)
      // A miss returns the menu rather than an error. The model that guessed a name wrong has
      // one useful next move, and making it spend a retry to discover that is pure waste.
      if (loaded.length === 0) {
        const asked = wanted.length > 0 ? `nothing matched ${wanted.map((w) => `"${w}"`).join(", ")}. ` : ""
        return `${asked}Loadable tools:\n${loadout.catalog()}`
      }
      return `loaded ${loaded.join(", ")} — their schemas are in the next request, so call them directly now.`
    },
  })
