import { tool } from "ai"
import { z } from "zod"
import { clip, ToolError, type ToolContext } from "./context.ts"

const MAX_OUTPUT = 40_000
const TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 5

function parseUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ToolError(`not a valid URL: ${url}`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ToolError(`only http and https are supported, got ${parsed.protocol}`)
  }
  return parsed
}

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
      let target = parseUrl(url)
      const signal = AbortSignal.timeout(TIMEOUT_MS)
      let response: Response
      for (let hop = 0; ; hop++) {
        // The URL is the subject, so `"webfetch:https://docs.example.com/"` in the config allows
        // a host. Redirects are followed by hand and checked again, so an allowed host can't
        // bounce the request to one that isn't.
        await ctx.gate.check({ tool: "webfetch", title: `fetch ${target.host}`, detail: target.href, subject: target.href })
        try {
          response = await fetch(target, { signal, headers: { "user-agent": "jarvis" }, redirect: "manual" })
        } catch (error) {
          throw new ToolError(`fetch failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        const location = response.headers.get("location")
        if (response.status < 300 || response.status >= 400 || !location) break
        if (hop >= MAX_REDIRECTS) throw new ToolError(`more than ${MAX_REDIRECTS} redirects fetching ${url}`)
        target = parseUrl(new URL(location, target).href)
      }
      if (!response.ok) throw new ToolError(`${response.status} ${response.statusText} for ${url}`)

      const type = response.headers.get("content-type") ?? ""
      const body = await response.text()
      const text = type.includes("html") ? textFromHtml(body) : body
      return clip(text.trim() || "(the response was empty)", MAX_OUTPUT)
    },
  })
