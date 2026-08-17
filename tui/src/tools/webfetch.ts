import { tool } from "ai"
import { z } from "zod"
import { clip, ToolError, type ToolContext } from "./context.ts"

const MAX_OUTPUT = 40_000
const TIMEOUT_MS = 20_000

/**
 * Enough HTML stripping to read documentation, and no more. A real HTML-to-markdown
 * converter is a dependency and a maintenance surface for something the model handles
 * fine from rough text.
 */
export function textFromHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export const webfetchTool = (ctx: ToolContext) =>
  tool({
    description: "Fetch a URL and return its text. HTML is stripped to readable text; JSON and text come back as-is.",
    inputSchema: z.object({
      url: z.string().describe("Absolute http(s) URL"),
    }),
    execute: async ({ url }) => {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new ToolError(`not a valid URL: ${url}`)
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ToolError(`only http and https are supported, got ${parsed.protocol}`)
      }

      // The URL is the subject, so `"webfetch:https://docs."` in the config allows a
      // family of hosts the same way `"bash:git "` allows a family of commands.
      await ctx.gate.check({ tool: "webfetch", title: `fetch ${parsed.host}`, detail: url, subject: url })

      let response: Response
      try {
        response = await fetch(parsed, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { "user-agent": "jarvis" },
        })
      } catch (error) {
        throw new ToolError(`fetch failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!response.ok) throw new ToolError(`${response.status} ${response.statusText} for ${url}`)

      const type = response.headers.get("content-type") ?? ""
      const body = await response.text()
      const text = type.includes("html") ? textFromHtml(body) : body
      return clip(text.trim() || "(the response was empty)", MAX_OUTPUT)
    },
  })
