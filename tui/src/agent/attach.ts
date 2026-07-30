import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, isAbsolute, relative, resolve } from "node:path"
import type { FilePart, TextPart } from "ai"

/** Images the model can actually look at. Anything else it can `read` for itself. */
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

/** Refused past this size: a few megabytes of base64 costs more than it is ever worth. */
const MAX_BYTES = 5 * 1024 * 1024

/** `@path` tokens, the same ones the editor completes. */
const MENTION = /(?:^|\s)@(\S+)/g

export type Attached = { content: string | (TextPart | FilePart)[]; notes: string[] }

/**
 * Turns `@screenshot.png` in a prompt into an image the model can see. Text files are
 * deliberately left alone — their path is right there in the prompt and `read` handles
 * them, whereas inlining every mentioned file would blow up the context silently.
 *
 * Base64 rather than a Uint8Array because messages are persisted as JSON.
 */
export function attach(prompt: string, cwd: string): Attached {
  const files: FilePart[] = []
  const notes: string[] = []
  const seen = new Set<string>()

  for (const [, mention] of prompt.matchAll(MENTION)) {
    if (!mention) continue
    // Trailing punctuation is far more likely to be prose than part of a filename.
    const path = mention.replace(/[),.;:]+$/, "")
    const mediaType = IMAGE_TYPES[extname(path).toLowerCase()]
    if (!mediaType || seen.has(path)) continue
    seen.add(path)

    const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path)
    if (relative(cwd, absolute).startsWith("..")) {
      notes.push(`skipped ${path}: outside the workspace`)
      continue
    }
    if (!existsSync(absolute)) continue
    const { size } = statSync(absolute)
    if (size > MAX_BYTES) {
      notes.push(`skipped ${path}: ${Math.round(size / 1024 / 1024)}MB is over the ${MAX_BYTES / 1024 / 1024}MB limit`)
      continue
    }
    files.push({ type: "file", data: readFileSync(absolute).toString("base64"), mediaType })
    notes.push(`attached ${path}`)
  }

  // A plain string when there is nothing to attach, so the common case is unchanged.
  if (files.length === 0) return { content: prompt, notes }
  return { content: [{ type: "text", text: prompt }, ...files], notes }
}
