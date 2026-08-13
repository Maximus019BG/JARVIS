import { describe, expect, test } from "bun:test"
import { hostedEntry, hostedGuidance, HOSTED_ID, withHostedFallback } from "../src/agent/hosted.ts"
import {
  discoveryArgs,
  mergeDiscovered,
  parseAnthropicModels,
  parseOpenAIModels,
} from "../src/agent/model-discovery.ts"
import { classifyFailure, scrub } from "../src/agent/provider-test.ts"
import { defaultModelID, listModels } from "../src/agent/provider.ts"
import { ConfigSchema, type Config, type ProviderConfig } from "../src/config/config.ts"
import { providerHealth } from "../src/config/provider-status.ts"
import { segments } from "../src/ui/components/status.tsx"

const config = (over: Partial<Config> = {}): Config => ConfigSchema.parse(over)

const credentials = {
  baseUrl: "https://cloud.example.com/",
  deviceId: "dev_1",
  token: "jvd_secrettoken1234",
  workstationId: "wst_1",
}

const entry = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  npm: "@ai-sdk/openai-compatible",
  options: { apiKey: "" },
  models: { "m-1": {} },
  enabled: true,
  ...over,
})

describe("withHostedFallback", () => {
  test("an unpaired device is left exactly as it was", () => {
    const before = config()
    expect(withHostedFallback(before, undefined)).toBe(before)
    expect(() => defaultModelID(withHostedFallback(before, undefined))).toThrow()
  })

  test("a paired device with nothing configured gets one working provider", () => {
    const after = withHostedFallback(config(), credentials)
    expect(Object.keys(after.provider)).toEqual([HOSTED_ID])
    expect(listModels(after).length).toBeGreaterThan(0)
    // The whole point: this is what stops a fresh install from throwing on its first message.
    expect(() => defaultModelID(after)).not.toThrow()
  })

  test("somebody who configured their own provider is not second-guessed", () => {
    const mine = config({ provider: { mine: entry() } })
    expect(withHostedFallback(mine, credentials)).toBe(mine)
  })

  test("an explicit model choice survives the fallback", () => {
    const pinned = config({ model: "later/model" })
    expect(withHostedFallback(pinned, credentials).model).toBe("later/model")
  })

  test("the base URL is joined without a double slash", () => {
    expect(hostedEntry(credentials).options.baseURL).toBe("https://cloud.example.com/api/gateway/v1")
  })

  test("guidance names both ways out, and goes quiet once there is a model", () => {
    const guidance = hostedGuidance(config())
    expect(guidance).toContain("/provider")
    expect(guidance).toContain("jarvis pair")
    expect(hostedGuidance(config({ provider: { mine: entry() } }))).toBeUndefined()
  })
})

describe("classifyFailure", () => {
  const at = (message: string, over: Partial<ProviderConfig> = {}) =>
    classifyFailure(new Error(message), config(), process.cwd(), "acme", entry(over))

  test("a missing package is an install problem, not a network one", () => {
    // The message mentions the registry, so a naive network check would claim it first.
    expect(at("failed to install @ai-sdk/nope: 404 fetch failed").stage).toBe("install")
  })

  test("a package that loaded but exports nothing usable is a factory problem", () => {
    expect(at("@ai-sdk/x exports no create* factory; set provider.export in the config").stage).toBe("factory")
    expect(at("@ai-sdk/x factory did not return an AI SDK provider").stage).toBe("factory")
  })

  test("an auth failure is named as one and points at the variable behind it", () => {
    const outcome = at("401 Unauthorized: invalid apiKey", { options: { apiKey: "" } })
    expect(outcome.stage).toBe("auth")
    expect(outcome.hint).toBeTruthy()
  })

  test("a refused connection is a network problem", () => {
    expect(at("connect ECONNREFUSED 127.0.0.1:11434").stage).toBe("network")
  })

  test("anything else is attributed to the model rather than guessed at", () => {
    expect(at("model `gpt-9` does not exist").stage).toBe("model")
  })

  test("a key echoed back by an SDK never reaches the message", () => {
    const withKey = entry({ options: { apiKey: "sk-live-abcdefgh1234" } })
    const outcome = classifyFailure(
      new Error("rejected key sk-live-abcdefgh1234"),
      config(),
      process.cwd(),
      "acme",
      withKey,
    )
    expect(outcome.message).not.toContain("sk-live-abcdefgh1234")
    expect(scrub("token jvd_abcdefgh1234 leaked", withKey)).not.toContain("jvd_abcdefgh1234")
  })
})

describe("model discovery parsing", () => {
  test("the OpenAI shape", () => {
    expect(parseOpenAIModels({ data: [{ id: "gpt-5", owned_by: "openai" }] })).toEqual([
      { id: "gpt-5", label: "gpt-5", hint: "openai", source: "endpoint" },
    ])
  })

  test("a `models` key and bare strings are read too", () => {
    expect(parseOpenAIModels({ models: ["a", { id: "b" }] }).map((m) => m.id)).toEqual(["a", "b"])
  })

  test("the Anthropic shape carries a display name as the hint", () => {
    expect(parseAnthropicModels({ data: [{ id: "claude-x", display_name: "Claude X" }] })).toEqual([
      { id: "claude-x", label: "claude-x", hint: "Claude X", source: "endpoint" },
    ])
  })

  test("garbage is an empty list, never a throw", () => {
    for (const junk of [null, undefined, 42, "text", {}, { data: "no" }, [1, 2]]) {
      expect(parseOpenAIModels(junk)).toEqual([])
      expect(parseAnthropicModels(junk)).toEqual([])
    }
  })

  test("the endpoint wins a collision, and catalog-only models come after", () => {
    // The endpoint knows what it will actually serve; the catalog is a superset that may include
    // models this key has no access to.
    const merged = mergeDiscovered(
      [{ id: "shared", label: "from endpoint", source: "endpoint" }],
      [
        { id: "shared", label: "from catalog", source: "catalog" },
        { id: "extra", label: "extra", source: "catalog" },
      ],
    )
    expect(merged.map((m) => m.label)).toEqual(["from endpoint", "extra"])
  })
})

describe("discoveryArgs", () => {
  const draft = { presetID: "openai", npm: "@ai-sdk/openai", keyMode: "store", key: "sk-1" }

  test("it is stable across renders, so an effect keyed on it does not loop", () => {
    // The bug this guards: keying the lookup on the whole draft re-ran it — aborting the request
    // and blanking the list — every time the reader toggled a model.
    expect(JSON.stringify(discoveryArgs(draft))).toBe(JSON.stringify(discoveryArgs({ ...draft })))
  })

  test("toggling models does not change what would be asked", () => {
    const a = discoveryArgs({ ...draft })
    const b = discoveryArgs({ ...draft })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test("a package with an implied endpoint still gets a base URL to ask", () => {
    expect(discoveryArgs(draft)?.baseURL).toBe("https://api.openai.com/v1")
    expect(discoveryArgs({ ...draft, npm: "@ai-sdk/anthropic" })?.baseURL).toBe("https://api.anthropic.com/v1")
  })

  test("an explicit base URL wins over the implied one", () => {
    expect(discoveryArgs({ ...draft, baseURL: "https://mine/v1" })?.baseURL).toBe("https://mine/v1")
  })

  test("a typed key is used to ask, and an env-var key is not guessed at", () => {
    expect(discoveryArgs(draft)?.apiKey).toBe("sk-1")
    expect(discoveryArgs({ ...draft, keyMode: "env" })?.apiKey).toBeUndefined()
  })

  test("a custom provider's id is not passed off as a catalog vendor", () => {
    expect(discoveryArgs({ ...draft, presetID: "custom" })?.providerID).toBeUndefined()
    expect(discoveryArgs(draft)?.providerID).toBe("openai")
  })

  test("an unknown preset asks for nothing rather than guessing", () => {
    expect(discoveryArgs({ ...draft, presetID: "nope" })).toBeUndefined()
  })
})

describe("providerHealth", () => {
  test("a provider with no key at all is not reported as broken", () => {
    // ollama and friends legitimately need none; flagging them would train the reader to ignore
    // the indicator.
    const health = providerHealth(config({ provider: { ollama: entry({ options: {} }) } }), process.cwd())
    expect(health.broken).toEqual([])
    expect(health.warning).toBeUndefined()
  })

  test("a key that expands to nothing is reported, and named when it is the only one", () => {
    const health = providerHealth(config({ provider: { acme: entry() } }), process.cwd())
    expect(health.broken).toEqual(["acme"])
    expect(health.warning).toContain("acme")
  })

  test("several broken providers are counted rather than listed", () => {
    const health = providerHealth(config({ provider: { acme: entry(), other: entry() } }), process.cwd())
    expect(health.warning).toContain("2 providers")
  })
})

describe("the status line warning", () => {
  const base = { model: "acme/m-1", cwd: "/a/b", usage: { input: 0, output: 0, cost: 0 }, width: 40 }

  test("it survives a narrow terminal, unlike the optional segments", () => {
    const narrow = segments({ ...base, warn: "⚠ acme has no key" })
    expect(narrow.warn).toBe("⚠ acme has no key")
  })

  test("it costs the optional segments their space rather than being dropped itself", () => {
    const without = segments({ ...base, width: 60, usage: { input: 5000, output: 100, cost: 1.5 } })
    const with_ = segments({ ...base, width: 60, usage: { input: 5000, output: 100, cost: 1.5 }, warn: "⚠ x" })
    const length = (parts: { text: string }[]) => parts.reduce((n, p) => n + p.text.length, 0)
    expect(length(with_.right)).toBeLessThanOrEqual(length(without.right))
    expect(with_.warn).toBe("⚠ x")
  })
})
