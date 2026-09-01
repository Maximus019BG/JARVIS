import { describe, expect, test } from "bun:test"
import {
  backStep,
  beginPair,
  remainingSteps,
  SKIP_EMAIL,
  stepSpec,
  submitStep,
  validate,
  type PairCtx,
} from "../src/ui/pair-setup.ts"
import { pairArgs } from "../src/cli/pair-flow.ts"

const defaults = { name: "workshop-pi", fingerprint: "abc123def456", platform: "linux-arm64 · workshop-pi" }
const ctx: PairCtx = { defaults }

describe("step order", () => {
  test("asks for the url first when nothing is known", () => {
    expect(beginPair(ctx).step).toBe("url")
  })

  test("skips the url when the installer or environment already supplied one", () => {
    const pair = beginPair({ ...ctx, knownBaseUrl: "https://jarvis.example" })
    expect(pair.step).toBe("email")
    expect(remainingSteps(pair.draft, "url")).not.toContain("url")
  })

  test("walks url -> email -> confirm -> waiting", () => {
    let pair = beginPair(ctx)
    pair = submitStep(pair, "https://jarvis.example")
    expect(pair.step).toBe("email")
    pair = submitStep(pair, "me@example.com")
    expect(pair.step).toBe("confirm")
    pair = submitStep(pair, "bench-pi")
    expect(pair.step).toBe("waiting")
    expect(pair.draft).toMatchObject({ baseUrl: "https://jarvis.example", email: "me@example.com", name: "bench-pi" })
  })

  test("a trailing slash on the url is dropped, so the request path cannot double up", () => {
    const pair = submitStep(beginPair(ctx), "https://jarvis.example/")
    expect(pair.draft.baseUrl).toBe("https://jarvis.example")
  })
})

describe("the email step is optional", () => {
  test("blank leaves the request unaddressed rather than failing", () => {
    let pair = submitStep(beginPair(ctx), "https://jarvis.example")
    pair = submitStep(pair, "")
    expect(pair.step).toBe("confirm")
    expect(pair.draft.email).toBe("")
  })

  test("skipping explicitly is the same as leaving it blank", () => {
    let pair = submitStep(beginPair(ctx), "https://jarvis.example")
    pair = submitStep(pair, SKIP_EMAIL)
    expect(pair.draft.email).toBe("")
  })
})

describe("validation", () => {
  test("a url without a scheme is refused rather than guessed at", () => {
    const pair = beginPair(ctx)
    expect(validate(pair, "jarvis.example")).toBeDefined()
    expect(validate(pair, "https://jarvis.example")).toBeUndefined()
  })

  test("an invalid value keeps the step and attaches the reason", () => {
    const pair = submitStep(beginPair(ctx), "not-a-url")
    expect(pair.step).toBe("url")
    expect(stepSpec(pair).error).toBeDefined()
  })

  test("a malformed email is refused, a real one is not", () => {
    const pair = submitStep(beginPair(ctx), "https://jarvis.example")
    expect(validate(pair, "nope")).toBeDefined()
    expect(validate(pair, "me@example.com")).toBeUndefined()
  })

  test("an empty device name is refused — the approver has to recognise something", () => {
    let pair = submitStep(beginPair(ctx), "https://jarvis.example")
    pair = submitStep(pair, "")
    expect(validate(pair, "   ")).toBeDefined()
  })
})

describe("back navigation", () => {
  test("walks history, so a skipped step is skipped on the way out too", () => {
    let pair = beginPair({ ...ctx, knownBaseUrl: "https://jarvis.example" })
    pair = submitStep(pair, "me@example.com")
    expect(pair.step).toBe("confirm")
    pair = backStep(pair)
    // Not `url`: it was never asked, so going back must not land on it.
    expect(pair.step).toBe("email")
    expect(backStep(pair).step).toBe("email")
  })

  test("clears the error from the step being left", () => {
    let pair = submitStep(beginPair(ctx), "https://jarvis.example")
    pair = submitStep(pair, "nope")
    expect(pair.error).toBeDefined()
    expect(backStep(pair).error).toBeUndefined()
  })
})

describe("an already-paired device", () => {
  test("opens on its status, not on the first question", () => {
    const pair = beginPair({
      ...ctx,
      existing: { deviceId: "dev_abc", workstationId: "ws_1", baseUrl: "https://jarvis.example", name: "bench-pi" },
    })
    expect(pair.step).toBe("status")
    expect(stepSpec(pair).choices?.map((choice) => choice.value)).toEqual(["close", "unpair"])
  })

  test("the status step claims no position in the question count", () => {
    const pair = beginPair({ ...ctx, existing: { deviceId: "d", workstationId: "w", baseUrl: "https://x.example" } })
    expect(stepSpec(pair).position.total).toBe(0)
  })
})

describe("cli arguments are read by shape, not position", () => {
  test("either order works", () => {
    expect(pairArgs(["me@example.com", "https://jarvis.example"])).toEqual({
      email: "me@example.com",
      baseUrl: "https://jarvis.example",
    })
    expect(pairArgs(["https://jarvis.example", "me@example.com"])).toEqual({
      email: "me@example.com",
      baseUrl: "https://jarvis.example",
    })
  })

  test("the form that already shipped keeps working", () => {
    expect(pairArgs(["https://jarvis.example"])).toEqual({ baseUrl: "https://jarvis.example" })
  })

  test("an email alone is an email", () => {
    expect(pairArgs(["me@example.com"])).toEqual({ email: "me@example.com" })
  })
})
