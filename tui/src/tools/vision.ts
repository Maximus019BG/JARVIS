import { tool } from "ai"
import { z } from "zod"
import { readCredentials } from "../blueprint/credentials.ts"
import { openFeed, snapshot } from "../pi/camera.ts"
import { describeFound, findItems } from "../pi/items-client.ts"
import { ToolError, type ToolContext } from "./context.ts"

/**
 * Looks through the user's webcam for items they taught with `/learn`. One photo, matched on
 * the paired cloud and dropped there. The permission gate stands in front of it like any
 * tool, which is the point: this is the agent asking to use the camera.
 */
export const findItemTool = (_ctx: ToolContext, options: { threshold?: number } = {}) =>
  tool({
    description: [
      "Look through the user's camera for physical items they have taught JARVIS (with /learn),",
      "and say whether and where each is in view. Use it when the user asks where something is",
      "or whether you can see it. Positions are thirds of the view from the user's side (the camera is mirrored).",
    ].join(" "),
    inputSchema: z.object({
      item: z.string().optional().describe("Name of one taught item. Omit to look for all of them"),
    }),
    execute: async ({ item }) => {
      const credentials = readCredentials()
      if (!credentials) throw new ToolError("this device is not paired, and items are found on the paired cloud")
      const feed = openFeed()
      try {
        const shot = await snapshot(feed)
        const { items } = await findItems(credentials, shot.jpeg, { item, threshold: options.threshold })
        return items.map((found) => describeFound(found, feed.camera)).join("\n")
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/no items taught/.test(message)) return "no items taught yet — the user can teach one with /learn <name>"
        if (/no such item/.test(message)) return `nothing called "${item}" has been taught — the user can teach it with /learn ${item}`
        throw new ToolError(message)
      } finally {
        feed.release()
      }
    },
  })
