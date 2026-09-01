import { describe, expect, test } from "bun:test"
import { PairCancelled, pollForToken, requestCode, type CodeResponse } from "../src/cli/pair-flow.ts"

/**
 * The RFC 8628 client, driven against a stub of the real routes.
 *
 * Worth a real server rather than a mocked `fetch`: the retry rules are the part most likely
 * to be got wrong, and `slow_down` vs `authorization_pending` vs terminal only differ by
 * status code and a string in the body — exactly what a hand-written mock tends to smooth over.
 */
function stub(handler: (path: string, body: Record<string, unknown>) => Response) {
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      return handler(new URL(request.url).pathname, body)
    },
  })
  return { url: `http://localhost:${server.port}`, stop: () => server.stop(true) }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const CODE: CodeResponse = {
  userCode: "WXYZ-3QF7",
  deviceCode: "dc",
  verificationUri: "http://x/link",
  verificationUriComplete: "http://x/link?code=WXYZ-3QF7",
  expiresIn: 600,
  // Zero so the tests do not spend real seconds sleeping between polls.
  interval: 0,
}

describe("requestCode", () => {
  test("sends the fingerprint and platform, and the email when there is one", async () => {
    let seen: Record<string, unknown> = {}
    const server = stub((_path, body) => {
      seen = body
      return json({ ...CODE, qr: "▀▄" })
    })
    try {
      const code = await requestCode(server.url, { name: "bench-pi", email: "me@example.com" })
      expect(code.qr).toBe("▀▄")
      expect(seen.name).toBe("bench-pi")
      expect(seen.email).toBe("me@example.com")
      expect(typeof seen.fingerprint).toBe("string")
      expect((seen.fingerprint as string).length).toBeGreaterThan(8)
    } finally {
      server.stop()
    }
  })

  test("omits the email entirely when none was given, rather than sending null", async () => {
    let seen: Record<string, unknown> = {}
    const server = stub((_path, body) => {
      seen = body
      return json(CODE)
    })
    try {
      await requestCode(server.url, { name: "bench-pi" })
      expect("email" in seen).toBe(false)
    } finally {
      server.stop()
    }
  })

  test("a server that is not there is reported as an address problem", async () => {
    const server = stub(() => json({ error: "nope" }, 500))
    try {
      await expect(requestCode(server.url, { name: "x" })).rejects.toThrow(/could not start pairing/)
    } finally {
      server.stop()
    }
  })
})

describe("pollForToken", () => {
  test("keeps polling through authorization_pending and takes the token when it lands", async () => {
    let polls = 0
    const server = stub(() => {
      polls += 1
      if (polls < 3) return json({ error: "authorization_pending" }, 400)
      return json({ deviceId: "dev_1", token: "jvd_x", workstationId: "ws_1", name: "bench-pi" })
    })
    try {
      const paired = await pollForToken(server.url, CODE)
      expect(paired).toMatchObject({ deviceId: "dev_1", token: "jvd_x", workstationId: "ws_1" })
      expect(polls).toBe(3)
    } finally {
      server.stop()
    }
  })

  // Deliberately slow: RFC 8628 says back off by five seconds, so proving the backoff
  // happened means actually waiting for it. One five-second test is worth pinning the rule
  // that stops a device hammering a server that just asked it not to.
  test(
    "backs off by five seconds on slow_down instead of giving up",
    async () => {
      let polls = 0
      const server = stub(() => {
        polls += 1
        if (polls === 1) return json({ error: "slow_down" }, 429)
        return json({ deviceId: "dev_1", token: "jvd_x", workstationId: "ws_1", name: "n" })
      })
      try {
        const started = Date.now()
        await expect(pollForToken(server.url, CODE)).resolves.toMatchObject({ deviceId: "dev_1" })
        expect(polls).toBe(2)
        // Started at interval 0, so every millisecond of this is the backoff.
        expect(Date.now() - started).toBeGreaterThanOrEqual(4900)
      } finally {
        server.stop()
      }
    },
    10_000,
  )

  test("stops on access_denied — a denied pairing is not a retry", async () => {
    let polls = 0
    const server = stub(() => {
      polls += 1
      return json({ error: "access_denied" }, 400)
    })
    try {
      await expect(pollForToken(server.url, CODE)).rejects.toThrow(/denied or already used/)
      expect(polls).toBe(1)
    } finally {
      server.stop()
    }
  })

  test("stops on expired_token rather than hammering a dead request", async () => {
    const server = stub(() => json({ error: "expired_token" }, 400))
    try {
      await expect(pollForToken(server.url, CODE)).rejects.toThrow(/pairing failed/)
    } finally {
      server.stop()
    }
  })

  test("gives up once the code's own lifetime is over", async () => {
    const server = stub(() => json({ error: "authorization_pending" }, 400))
    try {
      // expiresIn 0 means the deadline is already past on the first check.
      await expect(pollForToken(server.url, { ...CODE, expiresIn: 0 })).rejects.toThrow(/expired/)
    } finally {
      server.stop()
    }
  })

  test("counts down, so the wizard can show how long is left", async () => {
    const ticks: number[] = []
    let polls = 0
    const server = stub(() => {
      polls += 1
      if (polls < 2) return json({ error: "authorization_pending" }, 400)
      return json({ deviceId: "d", token: "t", workstationId: "w", name: "n" })
    })
    try {
      await pollForToken(server.url, CODE, { onTick: (left) => ticks.push(left) })
      expect(ticks.length).toBeGreaterThan(0)
      expect(ticks[0]).toBeLessThanOrEqual(600)
    } finally {
      server.stop()
    }
  })

  test("aborting is a cancellation, not a failure the UI has to report", async () => {
    const server = stub(() => json({ error: "authorization_pending" }, 400))
    const controller = new AbortController()
    try {
      const polling = pollForToken(server.url, { ...CODE, interval: 5 }, { signal: controller.signal })
      controller.abort()
      await expect(polling).rejects.toBeInstanceOf(PairCancelled)
    } finally {
      server.stop()
    }
  })
})
