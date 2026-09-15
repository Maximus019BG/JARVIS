import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigSchema } from "../src/config/config.ts"
import { PERSONAS, continuityBlock, operatorBlock, resolvePersona, systemPrompt, toolsBlock } from "../src/agent/prompt.ts"

const scratch = () => mkdtempSync(join(tmpdir(), "jarvis-prompt-"))

describe("resolvePersona", () => {
  test("builtin names resolve to their text", () => {
    expect(resolvePersona("jarvis", scratch())).toBe(PERSONAS.jarvis!)
  })

  test("plain resolves to nothing rather than being unknown", () => {
    expect(resolvePersona("plain", scratch())).toBe("")
  })

  test("a path is read as the persona", () => {
    const dir = scratch()
    writeFileSync(join(dir, "house.md"), "  Speak only in questions.  \n")
    expect(resolvePersona("house.md", dir)).toBe("Speak only in questions.")
  })

  // The loud half of the contract: a typo in a persona name must not quietly hand back a
  // different voice than the one that was configured.
  test("an unknown name is an error, not a fallback", () => {
    expect(() => resolvePersona("javris", scratch())).toThrow(/unknown persona "javris"/)
  })
})

describe("operatorBlock", () => {
  test("absent when nothing is known", () => {
    expect(operatorBlock(ConfigSchema.parse({}))).toBeUndefined()
    expect(operatorBlock(ConfigSchema.parse({ operator: {} }))).toBeUndefined()
  })

  test("carries only the fields that were set", () => {
    const block = operatorBlock(ConfigSchema.parse({ operator: { name: "Maximus", address: "sir" } }))
    expect(block).toContain("name: Maximus")
    expect(block).toContain("address them as: sir")
    expect(block).not.toContain("about them")
  })
})

describe("continuityBlock", () => {
  const day = 86_400_000

  test("absent without a previous session, or without a title", () => {
    expect(continuityBlock()).toBeUndefined()
    expect(continuityBlock({ title: "", created: Date.now() })).toBeUndefined()
  })

  test("phrases the age in days", () => {
    expect(continuityBlock({ title: "wire the DHT22", created: Date.now() })).toContain("earlier today")
    expect(continuityBlock({ title: "wire the DHT22", created: Date.now() - day })).toContain("yesterday")
    expect(continuityBlock({ title: "wire the DHT22", created: Date.now() - 5 * day })).toContain("5 days ago")
  })
})

describe("toolsBlock", () => {
  test("absent when there is nothing to list", () => {
    expect(toolsBlock()).toBeUndefined()
    expect(toolsBlock([])).toBeUndefined()
  })

  // Sorted so the block is byte-identical turn to turn and stays inside the prompt cache.
  test("lists every name, sorted", () => {
    const block = toolsBlock(["read", "bash", "blueprint_symbol"])!
    expect(block.startsWith("<tools>")).toBe(true)
    expect(block).toContain("The only tools that exist: bash, blueprint_symbol, read")
    expect(toolsBlock(["read", "bash"])).toBe(toolsBlock(["bash", "read"]))
  })

  // The part a schema cannot say: that the list is exhaustive. Without it a model fills the
  // gap from training priors, and `browse` is what that looks like.
  test("says the list is closed", () => {
    expect(toolsBlock(["read"])!).toContain("Never invent a tool name")
  })

  test("still points at the rest of the set when tools are deferred", () => {
    const block = toolsBlock(["bash", "read", "tool_search"], true)!
    expect(block).toContain("Loaded at the start of this turn: bash, read, tool_search")
    expect(block).toContain("tool_search")
    // The set is still closed. What changed is that half of it is named elsewhere in the
    // same request rather than here, not that the model may now guess.
    expect(block).toContain("Never invent a tool name")
    expect(block).not.toContain("The only tools that exist")
    expect(toolsBlock(["read", "bash"], true)).toBe(toolsBlock(["bash", "read"], true))
  })

  test("says nothing about loading when nothing is deferred", () => {
    expect(toolsBlock(["read"], false)).toBe(toolsBlock(["read"]))
  })
})

describe("systemPrompt", () => {
  test("layers the persona over the base prompt, before the agent's own", () => {
    const prompt = systemPrompt({ config: ConfigSchema.parse({}), cwd: scratch(), agentPrompt: "You draw things." })
    expect(prompt.indexOf("<persona>")).toBeGreaterThan(prompt.indexOf("You are jarvis"))
    expect(prompt.indexOf("You draw things.")).toBeGreaterThan(prompt.indexOf("<persona>"))
  })

  // The whole point of splitting the two: turning the character off must not take a working
  // rule with it.
  test("plain drops the character and keeps every capability rule", () => {
    const prompt = systemPrompt({ config: ConfigSchema.parse({ persona: "plain" }), cwd: scratch() })
    expect(prompt).not.toContain("<persona>")
    expect(prompt).toContain("Never invent APIs, file paths or command output")
  })

  test("the tool list appears only when it was supplied", () => {
    const cwd = scratch()
    expect(systemPrompt({ config: ConfigSchema.parse({}), cwd })).not.toContain("<tools>")
    const named = systemPrompt({ config: ConfigSchema.parse({}), cwd, toolNames: ["webfetch", "read"] })
    expect(named).toContain("The only tools that exist: read, webfetch")
  })

  test("operator and continuity appear only when supplied", () => {
    const cwd = scratch()
    expect(systemPrompt({ config: ConfigSchema.parse({}), cwd })).not.toContain("<operator>")
    const full = systemPrompt({
      config: ConfigSchema.parse({ operator: { address: "sir" } }),
      cwd,
      previous: { title: "the rate-limit test", created: Date.now() },
    })
    expect(full).toContain("address them as: sir")
    expect(full).toContain("the rate-limit test")
  })
})
