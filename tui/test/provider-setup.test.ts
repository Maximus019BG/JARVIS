import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProviderConfigSchema, substitute } from "../src/config/config.ts"
import { checkEntry, checkMerged } from "../src/config/provider-plan.ts"
import { deleteSecret, readSecrets, secretRefName, writeSecret } from "../src/config/secrets.ts"
import { presetChoices } from "../src/ui/provider-presets.ts"
import {
  beginSetup,
  draftEntry,
  modelChoices,
  planWrites,
  stepSpec,
  submitStep,
  switchKeyMode,
  toggleModel,
  validate,
  type Setup,
  type SetupCtx,
} from "../src/ui/provider-setup.ts"

const ctx: SetupCtx = { existing: [], paired: true }

/** Walks the flow with canned answers, returning every step it stopped at. */
function walk(answers: (string | string[])[], context: SetupCtx = ctx): { steps: string[]; setup: Setup } {
  let setup = beginSetup(context)
  const steps = [setup.step as string]
  for (const answer of answers) {
    setup = submitStep(setup, answer, context)
    steps.push(setup.step)
  }
  return { steps, setup }
}

describe("secrets", () => {
  test("a missing secret expands to nothing instead of throwing", () => {
    // The regression guard for the {file:} trap: that kind throws on a missing file, which
    // index.tsx turns into exit 1. A moved secrets.json must never make jarvis unstartable.
    expect(() => substitute("{secret:nope}", process.cwd())).not.toThrow()
    expect(substitute("{secret:nope}", process.cwd())).toBe("")
  })

  test("a stored secret round-trips and the file is 0600", () => {
    const path = join(mkdtempSync(join(tmpdir(), "jarvis-secrets-")), "secrets.json")
    writeSecret("acme-api-key", "sk-live-1234", path)
    expect(readSecrets(path)["acme-api-key"]).toBe("sk-live-1234")
    // 0600 on POSIX; Windows does not carry the bits, so assert only where they mean something.
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600)

    writeSecret("other", "x", path)
    deleteSecret("acme-api-key", path)
    expect(readSecrets(path)["acme-api-key"]).toBeUndefined()
    expect(readSecrets(path).other).toBe("x")

    deleteSecret("other", path)
    expect(existsSync(path)).toBe(false)
  })

  test("a corrupt secrets file reads as empty rather than failing the load", () => {
    const path = join(mkdtempSync(join(tmpdir(), "jarvis-secrets-")), "secrets.json")
    writeFileSync(path, "not json")
    expect(readSecrets(path)).toEqual({})
  })

  test("secretRefName recognises only its own template", () => {
    expect(secretRefName("{secret:acme-api-key}")).toBe("acme-api-key")
    expect(secretRefName("{env:ACME_API_KEY}")).toBeUndefined()
  })
})

describe("step sequence", () => {
  // This is the "happy path is a few keypresses" claim, made assertable. If a preset starts
  // asking a question it used to answer for the reader, one of these fails.
  test("anthropic asks for a name, a key and models — nothing else", () => {
    const { steps } = walk(["anthropic", "anthropic", "sk-ant-123", ["claude-sonnet-4-5"]])
    expect(steps).toEqual(["preset", "id", "key", "models", "test"])
  })

  test("ollama never asks about a key at all", () => {
    const { steps } = walk(["ollama", "ollama", "http://localhost:11434/v1", ["llama3.2"]])
    expect(steps).toEqual(["preset", "id", "baseURL", "models", "test"])
  })

  test("the hosted provider asks for neither a package nor a key", () => {
    const { steps } = walk(["jarvis", "jarvis", ["jarvis-default"]])
    expect(steps).toEqual(["preset", "id", "models", "test"])
  })

  test("custom walks the whole path", () => {
    const { steps } = walk([
      "custom",
      "mine",
      "@ai-sdk/openai-compatible",
      "https://example.com/v1",
      "store",
      "sk-1",
      ["m1"],
    ])
    expect(steps).toEqual(["preset", "id", "npm", "baseURL", "keyMode", "key", "models", "test"])
  })

  test("a known preset skips the key-source question but keeps the choice reachable", () => {
    // Six keypresses versus four is the whole difference, so the question is not asked; the
    // escape hatch lives inside the key step instead.
    let setup = walk(["openai", "openai"]).setup
    expect(setup.step).toBe("key")

    setup = switchKeyMode(setup, "env")
    expect(setup.step).toBe("envName")
    expect(setup.draft.envName).toBe("OPENAI_API_KEY")

    setup = submitStep(setup, "MY_OPENAI_KEY", ctx)
    expect(setup.step).toBe("models")
    expect(draftEntry(setup.draft).entry.options.apiKey).toBe("{env:MY_OPENAI_KEY}")
  })

  test("switching back to a typed key returns to the key step", () => {
    const setup = switchKeyMode(switchKeyMode(walk(["openai", "openai"]).setup, "env"), "store")
    expect(setup.step).toBe("key")
  })

  test("the step counter counts the plan, not the full step list", () => {
    let setup = beginSetup(ctx)
    // Before a preset is chosen the plan is unknown, so no total is claimed — announcing 8 and
    // then dropping to 5 reads as though the form changed its mind.
    expect(stepSpec(setup, ctx).position).toEqual({ index: 1, total: 0 })

    setup = submitStep(setup, "anthropic", ctx)
    // preset, id, key, models, test — five, not the nine in ORDER.
    expect(stepSpec(setup, ctx).position).toEqual({ index: 2, total: 5 })

    // A preset that asks everything says so honestly.
    let custom = submitStep(beginSetup(ctx), "custom", ctx)
    expect(stepSpec(custom, ctx).position).toEqual({ index: 2, total: 8 })
  })

  test("back returns to the previous question and clears the error", () => {
    let setup = walk(["anthropic"]).setup
    setup = submitStep(setup, "", ctx)
    expect(setup.error).toBeTruthy()
    expect(setup.step).toBe("id")
  })
})

describe("validate", () => {
  const at = (step: string, draft: Partial<Setup["draft"]> = {}): Setup => ({
    ...beginSetup(ctx),
    step: step as Setup["step"],
    draft: { ...beginSetup(ctx).draft, ...draft },
  })

  test("rejects an id that collides with an existing provider", () => {
    expect(validate(at("id"), "openai", { existing: ["openai"], paired: true })).toMatch(/already exists/)
  })

  test("rejects an uppercase id", () => {
    expect(validate(at("id"), "OpenAI", ctx)).toBeTruthy()
    expect(validate(at("id"), "my-llm", ctx)).toBeUndefined()
  })

  test("rejects a baseURL that is not http", () => {
    expect(validate(at("baseURL"), "not a url", ctx)).toBe("not a URL")
    expect(validate(at("baseURL"), "ftp://x/y", ctx)).toMatch(/http/)
    expect(validate(at("baseURL"), "https://x/y", ctx)).toBeUndefined()
  })

  test("rejects a whitespace-only key", () => {
    expect(validate(at("key"), "   ", ctx)).toBeTruthy()
  })

  test("rejects an empty model set", () => {
    expect(validate(at("models"), [], ctx)).toMatch(/at least one/)
  })

  test("rejects an npm field that was given a URL", () => {
    expect(validate(at("npm"), "https://example.com", ctx)).toMatch(/URL/)
  })
})

describe("draftEntry and planWrites", () => {
  const drafted = (answers: (string | string[])[]) => walk(answers).setup.draft

  test("a stored key becomes a reference, and the literal is nowhere in the entry", () => {
    const draft = drafted(["anthropic", "anthropic", "sk-ant-secret", ["claude-sonnet-4-5"]])
    const { entry } = draftEntry(draft)
    expect(entry.options.apiKey).toBe("{secret:anthropic-api-key}")
    expect(JSON.stringify(entry)).not.toContain("sk-ant-secret")
  })

  test("the secret write comes before the config write", () => {
    const writes = planWrites(drafted(["anthropic", "anthropic", "sk-1", ["claude-sonnet-4-5"]]), {
      setDefaultModel: false,
    })
    expect(writes.map((write) => write.kind)).toEqual(["secret", "config"])
  })

  test("the environment mode emits a template and stores no secret", () => {
    const setup = submitStep(switchKeyMode(walk(["openai", "openai"]).setup, "env"), "OPENAI_API_KEY", ctx)
    const writes = planWrites(setup.draft, { setDefaultModel: false })
    expect(writes.some((write) => write.kind === "secret")).toBe(false)
    expect(draftEntry(setup.draft).entry.options.apiKey).toBe("{env:OPENAI_API_KEY}")
  })

  test("the hosted provider gets no apiKey in its config at all", () => {
    // Its credential is the pairing token, injected at startup. If it ever reached a config
    // file it would be committed, exported, and in every transcript.
    const draft = drafted(["jarvis", "jarvis", ["jarvis-default"]])
    expect(draftEntry(draft).entry.options.apiKey).toBeUndefined()
    expect(planWrites(draft, { setDefaultModel: true }).some((write) => write.kind === "secret")).toBe(false)
  })

  test("setDefaultModel makes the first provider immediately usable", () => {
    const writes = planWrites(drafted(["openai", "openai", "sk-1", ["gpt-5"]]), { setDefaultModel: true })
    expect(writes).toContainEqual({ kind: "config", path: ["model"], value: "openai/gpt-5" })
  })

  test("the entry survives the strict schema, and a stray key does not", () => {
    const { entry } = draftEntry(drafted(["openai", "openai", "sk-1", ["gpt-5"]]))
    expect(ProviderConfigSchema.safeParse(entry).success).toBe(true)
    expect(checkEntry(entry).ok).toBe(true)
    expect(checkEntry({ ...entry, bogus: 1 }).ok).toBe(false)
  })

  test("checkMerged rejects a default model no provider declares", () => {
    const { id, entry } = draftEntry(drafted(["openai", "openai", "sk-1", ["gpt-5"]]))
    const config = { provider: {} } as never
    expect(checkMerged(config, id, entry, "openai/gpt-5").ok).toBe(true)
    const missing = checkMerged(config, id, entry, "openai/nope")
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.problems[0]).toMatch(/declares no/)
  })
})

describe("presets and model choices", () => {
  test("an unpaired device is not offered the hosted provider", () => {
    expect(presetChoices({ paired: false }).map((choice) => choice.value)).not.toContain("jarvis")
    expect(presetChoices({ paired: true }).map((choice) => choice.value)).toContain("jarvis")
  })

  test("picking the same preset twice suggests a free name rather than refusing", () => {
    const { setup } = walk(["openai"], { existing: ["openai"], paired: true })
    expect(setup.draft.id).toBe("openai-2")
  })

  test("toggling a model marks it, and the done row counts the selection", () => {
    let setup = walk(["openai", "openai", "sk-1"]).setup
    expect(setup.step).toBe("models")
    // The preset already seeded gpt-5 and gpt-5-mini, so start from a model it did not.
    const discovered = [{ value: "o4-mini", label: "o4-mini" }]
    expect(setup.draft.models).not.toContain("o4-mini")

    setup = toggleModel(setup, "o4-mini")
    const rows = modelChoices(setup.draft, { ...ctx, discovered })
    expect(rows[0]!.label).toContain("(3 selected)")
    expect(rows.find((row) => row.value === "o4-mini")!.label).toStartWith("✓")

    setup = toggleModel(setup, "o4-mini")
    expect(setup.draft.models).not.toContain("o4-mini")
    expect(modelChoices(setup.draft, { ...ctx, discovered })[0]!.label).toContain("(2 selected)")
  })

  test("a preset default survives an endpoint that does not list it", () => {
    const draft = walk(["anthropic", "anthropic", "sk-1"]).setup.draft
    const rows = modelChoices(draft, { ...ctx, discovered: [{ value: "claude-3-haiku", label: "claude-3-haiku" }] })
    expect(rows.map((row) => row.value)).toContain("claude-sonnet-4-5")
    expect(rows.map((row) => row.value)).toContain("claude-3-haiku")
  })
})
