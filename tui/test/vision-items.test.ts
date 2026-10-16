import { afterAll, expect, test } from "bun:test"
import { calibrate, matrixOf, toScreen, type Pt } from "../src/pi/calibration.ts"
import { deleteItem, findItems, forgetItem, ITEM_COLOURS, itemColours, listItems } from "../src/pi/items-client.ts"

/** Stand-in for `GET` / `DELETE /api/vision/items`: a list, and a delete by id only. */
const items = [
  { id: "i1", name: "mug", samples: 6, updatedAt: "2026-10-01T00:00:00Z" },
  { id: "i2", name: "keys", samples: 4, updatedAt: "2026-10-02T00:00:00Z" },
]
const deleted: string[] = []
const server = Bun.serve({
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url)
    if (request.method === "GET") return Response.json({ items })
    const id = url.searchParams.get("id")!
    if (!items.some((item) => item.id === id)) return Response.json({ error: "not_found" }, { status: 404 })
    deleted.push(id)
    return Response.json({ success: true })
  },
})
/**
 * Stand-in for the ticket and detect routes: the first ticket predates a scope grant and is
 * refused with 403, the second one is minted after it and works.
 */
let minted = 0
const vision = Bun.serve({
  port: 0,
  fetch: (request) => {
    if (new URL(request.url).pathname === "/api/device/hand/ticket") {
      return Response.json({ ticket: `jvh_${++minted}`, expiresAt: Date.now() + 300_000 })
    }
    if (request.headers.get("authorization") !== "Bearer jvh_2") return Response.json({ error: "Forbidden" }, { status: 403 })
    return Response.json({ items: [], ms: 1 })
  },
})
afterAll(() => {
  server.stop(true)
  vision.stop(true)
})

const credentials = { baseUrl: `http://localhost:${server.port}`, deviceId: "d", token: "t", workstationId: "w" }

test("lists taught items, and forgets one by name through its id", async () => {
  expect((await listItems(credentials)).map((item) => item.name)).toEqual(["mug", "keys"])
  expect(await forgetItem(credentials, "nope")).toBe(false)
  expect(deleted).toEqual([])
  expect(await forgetItem(credentials, "mug")).toBe(true)
  expect(deleted).toEqual(["i1"])
})

test("deletes by id, the /forget picker's path, and says false for one already gone", async () => {
  expect(await deleteItem(credentials, "i2")).toBe(true)
  expect(await deleteItem(credentials, "gone")).toBe(false)
  expect(deleted).toEqual(["i1", "i2"])
})

test("gives each item a stable colour: by name, whatever order they arrive in, wrapping after the palette", () => {
  const taught = Array.from({ length: ITEM_COLOURS.length + 1 }, (_, index) => ({ id: `i${index}`, name: `item ${String.fromCharCode(97 + index)}` }))
  const forward = itemColours(taught)
  const backward = itemColours([...taught].reverse())
  for (const item of taught) expect(backward(item.id)).toEqual(forward(item.id))
  expect(forward("i0")).toEqual(ITEM_COLOURS[0]!)
  expect(forward("i1")).toEqual(ITEM_COLOURS[1]!)
  expect(forward(`i${ITEM_COLOURS.length}`)).toEqual(ITEM_COLOURS[0]!)
  expect(ITEM_COLOURS).toContainEqual(forward("taught-since"))
})

test("a find refused 403 retries once with a fresh ticket, so a scope granted a moment ago works", async () => {
  const fresh = { baseUrl: `http://localhost:${vision.port}`, deviceId: "d", token: "t", workstationId: "w" }
  expect(await findItems(fresh, new Uint8Array([0xff, 0xd8]))).toEqual({ items: [], ms: 1 })
  expect(minted).toBe(2)
})

test("maps a camera box onto screen fractions: stretched without a calibration, through it with one", () => {
  const camera = { width: 480, height: 360 }
  expect(toScreen({ x: 120, y: 90, w: 240, h: 180 }, camera)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })

  // The projected screen seen in the right half of the camera, upside down.
  const seen: Pt[] = [
    [240 + 0.85 * 240, 0.85 * 360],
    [240 + 0.15 * 240, 0.85 * 360],
    [240 + 0.15 * 240, 0.15 * 360],
    [240 + 0.85 * 240, 0.15 * 360],
  ]
  const result = calibrate(seen, camera, { width: 1, height: 1 }, "now")
  if ("error" in result) throw new Error(result.error)
  const screen = toScreen({ x: 240, y: 0, w: 120, h: 180 }, camera, matrixOf(result.calibration))
  for (const [got, want] of [
    [screen.x, 0.5],
    [screen.y, 0.5],
    [screen.w, 0.5],
    [screen.h, 0.5],
  ] as const)
    expect(got).toBeCloseTo(want, 6)
})
