import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { ConfigSchema, merge, substitute, configFiles, ConfigError } from "../src/config/config.ts"
import { persistPermission } from "../src/config/persist.ts"
import { catalogKey, modelInfo } from "../src/agent/catalog.ts"
import { parseModelID, listModels, defaultModelID } from "../src/agent/provider.ts"
import { parseArgs } from "../src/index.tsx"

const tmp = () => mkdtempSync(join(tmpdir(), "jarvis-test-"))

describe("merge", () => {
  test("merges nested objects, override wins on scalars", () => {
    expect(merge({ a: 1, b: { c: 1, d: 2 } }, { b: { c: 9 } })).toEqual({ a: 1, b: { c: 9, d: 2 } })
  })

  test("arrays replace rather than concatenate", () => {
    expect(merge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] })
  })
})

describe("substitute", () => {
  test("expands env vars inside strings, anywhere in the tree", () => {
    process.env.JARVIS_TEST_KEY = "sk-123"
    expect(substitute({ p: { apiKey: "{env:JARVIS_TEST_KEY}" } }, "/")).toEqual({ p: { apiKey: "sk-123" } })
  })

  test("missing env var becomes empty string", () => {
    expect(substitute("{env:JARVIS_DEFINITELY_UNSET}", "/")).toBe("")
  })

  test("expands file contents relative to the config file", () => {
    const dir = tmp()
    writeFileSync(join(dir, "key.txt"), "  secret\n")
    expect(substitute("Bearer {file:key.txt}", dir)).toBe("Bearer secret")
  })

  test("missing file is an error, not a silent empty value", () => {
    expect(() => substitute("{file:nope.txt}", tmp())).toThrow(ConfigError)
  })
})

describe("configFiles", () => {
  test("orders outer directories before inner ones so the nearest config wins", () => {
    const root = tmp()
    const nested = join(root, "a", "b")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "jarvis.jsonc"), "{}")
    writeFileSync(join(nested, "jarvis.json"), "{}")
    const found = configFiles(nested).filter((f) => f.startsWith(root))
    expect(found).toEqual([join(root, "jarvis.jsonc"), join(nested, "jarvis.json")])
  })
})

describe("ConfigSchema", () => {
  test("fills defaults and rejects unknown keys", () => {
    const parsed = ConfigSchema.parse({ model: "a/b" })
    expect(parsed.theme).toBe("jarvis")
    expect(parsed.provider).toEqual({})
    expect(ConfigSchema.safeParse({ nope: 1 }).success).toBe(false)
  })
})

describe("parseModelID", () => {
  test("splits on the first slash so model ids may contain slashes", () => {
    expect(parseModelID("velocity/verda.dstack/Kimi-K2.7")).toEqual({
      providerID: "velocity",
      modelID: "verda.dstack/Kimi-K2.7",
    })
  })

  test("rejects ids without a provider", () => {
    expect(() => parseModelID("gpt-5")).toThrow()
    expect(() => parseModelID("/gpt-5")).toThrow()
    expect(() => parseModelID("openai/")).toThrow()
  })
})

describe("catalogKey", () => {
  test("maps an npm package to its models.dev provider name", () => {
    // So `provider.velocity` pointing at `@ai-sdk/anthropic` still finds Anthropic's models.
    expect(catalogKey("@ai-sdk/anthropic")).toBe("anthropic")
    expect(catalogKey("@openrouter/ai-sdk-provider")).toBe("ai-sdk")
    expect(catalogKey("ollama-ai-provider")).toBe("ollama-ai")
  })

  test("stays off the network under test, so nothing depends on models.dev being up", async () => {
    expect(await modelInfo(["anthropic"], "claude-opus-4-5")).toEqual({})
  })
})

describe("model listing", () => {
  const config = ConfigSchema.parse({
    provider: {
      a: { npm: "x", models: { one: {}, two: { name: "Two" } } },
      off: { npm: "y", enabled: false, models: { three: {} } },
    },
  })

  test("skips disabled providers", () => {
    expect(listModels(config).map((m) => m.id)).toEqual(["a/one", "a/two"])
  })

  test("falls back to the first configured model", () => {
    expect(defaultModelID(config)).toBe("a/one")
    expect(defaultModelID(ConfigSchema.parse({ model: "a/two", ...config }))).toBe("a/two")
  })
})

describe("parseArgs", () => {
  test("collects flags and leaves the rest as positionals", () => {
    const flags = parseArgs(["run", "fix", "the", "bug", "-m", "a/b", "--yes"])
    expect(flags.rest).toEqual(["run", "fix", "the", "bug"])
    expect(flags.model).toBe("a/b")
    expect(flags.yes).toBe(true)
  })

  test("a flag missing its value is an error", () => {
    expect(() => parseArgs(["--model"])).toThrow()
  })
})

describe("persistPermission", () => {
  test("adds a rule while leaving comments and other keys intact", () => {
    const root = tmp()
    mkdirSync(join(root, ".git"), { recursive: true })
    mkdirSync(join(root, ".jarvis"), { recursive: true })
    const file = join(root, ".jarvis", "jarvis.jsonc")
    writeFileSync(file, '{\n  // keep me\n  "theme": "light"\n}\n')

    expect(persistPermission(root, "bash:git ", "allow")).toBe(file)
    const after = readFileSync(file, "utf8")
    expect(after).toContain("// keep me")
    expect(after).toContain('"theme": "light"')
    // And it parses back to the merged result.
    const parsed = ConfigSchema.parse(parseJsonc(after))
    expect(parsed.permission["bash:git "]).toBe("allow")
    expect(parsed.theme).toBe("light")
  })

  test("creates the config when the project has none", () => {
    const root = tmp()
    mkdirSync(join(root, ".git"), { recursive: true })
    const file = persistPermission(root, "webfetch", "allow")
    expect(file).toBe(join(root, ".jarvis", "jarvis.jsonc"))
    expect(parseJsonc(readFileSync(file, "utf8")).permission).toEqual({ webfetch: "allow" })
  })
})
