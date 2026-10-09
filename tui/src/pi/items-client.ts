import type { Credentials } from "../blueprint/credentials.ts"
import { call } from "../blueprint/sync.ts"
import { assertSecureUrl, ticketFor, type Camera } from "./hand-source.ts"

/**
 * The TUI's side of `/api/vision`: teach an item from a few boxed photos, find taught items
 * in one. The model runs on the server (`web/src/server/vision.ts`); photos are embedded and
 * dropped there, never stored.
 */

export type Box = { x: number; y: number; w: number; h: number }
export type Found = { id: string; name: string; found: boolean; best: number; boxes: (Box & { score: number })[] }

export class VisionError extends Error {}

function problem(status: number, body: unknown): string {
  const { error, detail } = (body ?? {}) as { error?: unknown; detail?: unknown }
  if (status === 401) return "this device is no longer authorised — run `jarvis pair`"
  if (status === 403) return "this device has no vision access — enable Vision for it in the web app, under Devices"
  if (status === 503) return "the vision model is not installed on the server — see web/models/items/README.md"
  if (typeof detail === "string") return detail
  return typeof error === "string" ? error : `vision request failed: ${status}`
}

/** `call` parses every body as JSON; a proxy's HTML error page should still read as an error. */
async function attempt<T>(request: () => ReturnType<typeof call<T>>): ReturnType<typeof call<T>> {
  try {
    return await request()
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, status: 502, body: { error: "the server sent something that is not JSON" } }
    throw error
  }
}

/** Teaches (or re-teaches, replacing) `name` from photos with the item boxed in each. */
export async function teachItem(
  credentials: Credentials,
  name: string,
  shots: readonly { jpeg: Uint8Array; box: Box }[],
): Promise<{ id: string; name: string; samples: number }> {
  assertSecureUrl(credentials.baseUrl)
  const images = shots.map(({ jpeg, box }) => ({
    jpeg: Buffer.from(jpeg).toString("base64"),
    box: [box.x, box.y, box.w, box.h].map(Math.round),
  }))
  const result = await attempt(() =>
    call<{ id: string; name: string; samples: number }>(credentials, "/api/vision/items", {
      method: "POST",
      body: JSON.stringify({ name, images }),
    }),
  )
  if (!result.ok) throw new VisionError(problem(result.status, result.body))
  return result.body
}

export type Taught = { id: string; name: string; samples: number; updatedAt: string }

/** Every item taught on this workstation, by name. */
export async function listItems(credentials: Credentials): Promise<Taught[]> {
  const result = await attempt(() => call<{ items: Taught[] }>(credentials, "/api/vision/items"))
  if (!result.ok) throw new VisionError(problem(result.status, result.body))
  return result.body.items
}

/** Forgets the item called `name`; false if nothing is. The route deletes by id, so this looks the name up first. */
export async function forgetItem(credentials: Credentials, name: string): Promise<boolean> {
  const item = (await listItems(credentials)).find((taught) => taught.name === name)
  if (!item) return false
  const result = await attempt(() =>
    call(credentials, `/api/vision/items?id=${encodeURIComponent(item.id)}`, { method: "DELETE" }),
  )
  if (!result.ok && result.status === 404) return false
  if (!result.ok) throw new VisionError(problem(result.status, result.body))
  return true
}

/**
 * Taught items in one photo, boxes in its pixels. Authenticated with the hand ticket rather
 * than the device token, which saves the server a database round trip per find.
 */
export async function findItems(
  credentials: Credentials,
  jpeg: Uint8Array<ArrayBuffer>,
  options: { item?: string; threshold?: number } = {},
): Promise<{ items: Found[]; ms: number }> {
  const base = assertSecureUrl(credentials.baseUrl).origin
  const query = new URLSearchParams()
  if (options.item) query.set("item", options.item)
  if (options.threshold !== undefined) query.set("threshold", String(options.threshold))
  const path = `/api/vision/detect${query.size > 0 ? `?${query}` : ""}`
  const post = (ticket: string) =>
    attempt(() =>
      call<{ items: Found[]; ms: number }>(credentials, path, {
        method: "POST",
        body: jpeg,
        headers: { "content-type": "image/jpeg", authorization: `Bearer ${ticket}` },
      }),
    )

  let ticket = await ticketFor(base, credentials.token)
  let result = await post(ticket)
  if (!result.ok && result.status === 401) {
    ticket = await ticketFor(base, credentials.token, ticket)
    result = await post(ticket)
  }
  if (!result.ok) throw new VisionError(problem(result.status, result.body))
  return result.body
}

/** Thirds of the view, e.g. "left · top". The feed is mirrored, so left is the viewer's left. */
export function where(box: Box, camera: Pick<Camera, "width" | "height">): string {
  const third = (at: number, names: readonly [string, string, string]) => names[Math.min(2, Math.max(0, Math.floor(at * 3)))]
  const x = (box.x + box.w / 2) / camera.width
  const y = (box.y + box.h / 2) / camera.height
  return `${third(x, ["left", "centre", "right"])} · ${third(y, ["top", "middle", "bottom"])}`
}

/** One line per item, for the agent and the find overlay alike. */
export function describeFound(item: Found, camera: Pick<Camera, "width" | "height">): string {
  const box = item.boxes[0]
  return box
    ? `${item.name}: in view, ${where(box, camera)} (${box.score.toFixed(2)})`
    : `${item.name}: not in view (closest ${item.best.toFixed(2)})`
}
