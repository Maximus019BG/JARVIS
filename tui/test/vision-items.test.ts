import { afterAll, expect, test } from "bun:test"
import { forgetItem, listItems } from "../src/pi/items-client.ts"

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
