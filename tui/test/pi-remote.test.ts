import { afterEach, describe, expect, test } from "bun:test"
import type { Frame } from "../src/pi/gestures.ts"
import { assertSecureUrl, remoteSource, splitJpegs } from "../src/pi/hand-source.ts"

const bytes = (...values: number[]) => new Uint8Array(values)
const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })

/** Fake JPEGs, `count` of them `everyMs` apart, then the camera "unplugs" after `tailMs`. */
const camera = (count: number, everyMs: number, tailMs = 300) => () => {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent === count) {
        await Bun.sleep(tailMs)
        controller.close()
        return
      }
      await Bun.sleep(everyMs)
      controller.enqueue(bytes(0xff, 0xd8, sent++, 0xff, 0xd9))
    },
  })
}

async function collect(source: ReturnType<typeof remoteSource>): Promise<{ frames: Frame[]; error?: string }> {
  const frames: Frame[] = []
  try {
    for await (const frame of source.frames()) frames.push(frame)
  } catch (error) {
    return { frames, error: (error as Error).message }
  }
  return { frames }
}

let server: ReturnType<typeof Bun.serve> | undefined
afterEach(() => server?.stop(true))

describe("splitJpegs", () => {
  test("cuts frames on SOI/EOI even when markers straddle chunks", async () => {
    const out: number[][] = []
    const stream = streamOf(bytes(0x00, 0xff, 0xd8, 1, 2), bytes(0xff), bytes(0xd9, 0xff, 0xd8, 3, 0xff, 0xd9, 7))
    for await (const jpeg of splitJpegs(stream)) out.push([...jpeg])
    expect(out).toEqual([
      [0xff, 0xd8, 1, 2, 0xff, 0xd9],
      [0xff, 0xd8, 3, 0xff, 0xd9],
    ])
  })
})

describe("remoteSource", () => {
  test("refuses to send the camera anywhere but https or localhost", () => {
    expect(() => assertSecureUrl("http://jarvis.example.com")).toThrow(/https/)
    expect(() => assertSecureUrl("https://jarvis.example.com")).not.toThrow()
    expect(() => assertSecureUrl("http://localhost:3000")).not.toThrow()
  })

  test("drops an answer that arrives after a newer one", async () => {
    let index = 0
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith("/ticket")) {
          return Response.json({ ticket: "t", expiresAt: Date.now() + 300_000 })
        }
        const mine = index++
        // The first frame is slow, so the second overtakes it.
        await Bun.sleep(mine === 0 ? 150 : 5)
        return Response.json({ hands: [{ score: mine, landmarks: [] }] })
      },
    })
    const { frames, error } = await collect(
      remoteSource({ baseUrl: `http://localhost:${server.port}`, token: "jvd_x", capture: camera(4, 20) }),
    )
    expect(error).toMatch(/camera stopped/)
    const answered = frames.map((frame) => frame.hands[0]!.score)
    expect(answered).not.toContain(0)
    // Capture time only ever moves forward, whatever order the network answered in.
    for (let i = 1; i < frames.length; i++) expect(frames[i]!.t).toBeGreaterThan(frames[i - 1]!.t)
  })

  test("a refused ticket is refreshed exactly once, then the frame goes through", async () => {
    let tickets = 0
    const seen: string[] = []
    server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname.endsWith("/ticket")) {
          expect(request.headers.get("authorization")).toBe("Bearer jvd_x")
          tickets += 1
          return Response.json({ ticket: `t${tickets}`, expiresAt: Date.now() + 300_000 })
        }
        const auth = request.headers.get("authorization")!
        seen.push(auth)
        // The first ticket has "expired" server-side.
        if (auth === "Bearer t1") return new Response("no", { status: 401 })
        return Response.json({ hands: [] })
      },
    })
    const { frames } = await collect(
      remoteSource({
        baseUrl: `http://localhost:${server.port}`,
        token: "jvd_x",
        inFlight: 1,
        capture: camera(3, 10, 100),
      }),
    )
    expect(tickets).toBe(2)
    expect(seen[0]).toBe("Bearer t1")
    expect(seen.slice(1).every((auth) => auth === "Bearer t2")).toBe(true)
    expect(frames.length).toBeGreaterThan(0)
  })

  test("a revoked device stops with a message instead of retrying forever", async () => {
    server = Bun.serve({ port: 0, fetch: () => new Response("no", { status: 401 }) })
    const { error } = await collect(
      remoteSource({ baseUrl: `http://localhost:${server.port}`, token: "jvd_x", capture: camera(2, 10) }),
    )
    expect(error).toMatch(/jarvis pair/)
  })
})
