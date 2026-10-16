import { afterAll, expect, test } from "bun:test"
import { forgetItem, ITEM_COLOURS, itemColours, listItems } from "../src/pi/items-client.ts"

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
    deleted.push(id)
    return Response.json({ success: true })
  },
})
afterAll(() => server.stop(true))

const credentials = { baseUrl: `http://localhost:${server.port}`, deviceId: "d", token: "t", workstationId: "w" }

test("lists taught items, and forgets one by name through its id", async () => {
  expect((await listItems(credentials)).map((item) => item.name)).toEqual(["mug", "keys"])
  expect(await forgetItem(credentials, "nope")).toBe(false)
  expect(deleted).toEqual([])
  expect(await forgetItem(credentials, "mug")).toBe(true)
  expect(deleted).toEqual(["i1"])
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
