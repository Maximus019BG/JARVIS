import { describe, expect, test, afterEach } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { credentialsPath, isPaired, readCredentials, writeCredentials } from "../src/blueprint/credentials.ts"
import { unpair } from "../src/cli/pair.ts"
import { normaliseBaseUrl, pairArgs } from "../src/cli/pair-flow.ts"

// test/setup.ts points XDG_DATA_HOME at a temp dir, so this is the sandbox copy, never the
// developer's real pairing.
const clear = () => rmSync(credentialsPath, { force: true })
afterEach(clear)

const seed = () =>
  writeCredentials({
    baseUrl: "https://jarvis.example",
    deviceId: "dev_test",
    token: "jvd_secret",
    workstationId: "ws_test",
    name: "bench-pi",
  })

describe("unpair", () => {
  test("does nothing without an explicit confirmation", () => {
    seed()
    unpair()
    expect(isPaired()).toBe(true)
  })

  test("removes the credentials once confirmed", () => {
    seed()
    expect(isPaired()).toBe(true)
    unpair({ yes: true })
    expect(existsSync(credentialsPath)).toBe(false)
    expect(isPaired()).toBe(false)
    expect(readCredentials()).toBeUndefined()
  })

  test("is safe to run when there is nothing to undo", () => {
    clear()
    expect(() => unpair({ yes: true })).not.toThrow()
  })
})

describe("pairing survives a restart", () => {
  test("credentials written once are readable again from a cold read", () => {
    seed()
    // What a reboot amounts to here: nothing in memory, everything from disk.
    expect(readCredentials()).toMatchObject({
      deviceId: "dev_test",
      workstationId: "ws_test",
      baseUrl: "https://jarvis.example",
    })
  })
})

describe("base urls", () => {
  test("a trailing slash is dropped, so a route cannot end up doubled", () => {
    expect(normaliseBaseUrl("https://jarvis.example/")).toBe("https://jarvis.example")
    expect(normaliseBaseUrl("  https://jarvis.example  ")).toBe("https://jarvis.example")
  })
})

describe("argument shapes", () => {
  test("an email and a url are told apart however they are ordered", () => {
    expect(pairArgs(["me@example.com", "https://jarvis.example"])).toEqual({
      email: "me@example.com",
      baseUrl: "https://jarvis.example",
    })
  })

  test("nothing given is nothing assumed", () => {
    expect(pairArgs([])).toEqual({})
  })
})
