import { describe, expect, test } from "bun:test"
import { tool } from "ai"
import { z } from "zod"
import { CORE_TOOLS, createLoadout, toolsUsedIn, TOOL_SEARCH } from "../src/tools/loadout.ts"
import type { ToolSet } from "../src/tools/index.ts"

const stub = (description: string) =>
  tool({ description, inputSchema: z.object({}), execute: async () => "" })

/** A tool set shaped like the real one: a few core names, the blueprint family, an MCP tool. */
const tools = (): ToolSet => ({
  read: stub("Read a file"),
  edit: stub("Edit a file"),
  bash: stub("Run a command"),
  blueprint_edit: stub("Draw on a blueprint"),
  blueprint_view: stub("Render a blueprint"),
  blueprint: stub("Manage blueprints"),
  blueprint_check: stub("Check a drawing"),
  engineering_calc: stub("Compute a value"),
  bash_output: stub("Read background output"),
  mcp_github_create_issue: stub("Create an issue on GitHub. Accepts a title and a body, and returns the number."),
})

describe("createLoadout", () => {
  test("keeps the core tools active and defers the rest", () => {
    const loadout = createLoadout(tools())
    expect(loadout.active().sort()).toEqual(["bash", "edit", "read", TOOL_SEARCH])
    expect(loadout.deferred()).toContain("blueprint_edit")
    expect(loadout.deferred()).toContain("mcp_github_create_issue")
    expect(loadout.deferred()).not.toContain("read")
  })

  test("knows tool_search even though it cannot be in the set that built it", () => {
    // tool_search is constructed *from* the loadout, so it is registered a line later. If the
    // loadout did not name it, the tool that does the loading would never be on the wire.
    const loadout = createLoadout(tools())
    expect(loadout.active()).toContain(TOOL_SEARCH)
    expect(loadout.all()).toContain(TOOL_SEARCH)
    expect(CORE_TOOLS).toContain(TOOL_SEARCH)
  })

  test("loading a tool makes it active without disturbing the rest", () => {
    const loadout = createLoadout(tools())
    expect(loadout.load(["engineering_calc"])).toEqual(["engineering_calc"])
    expect(loadout.active()).toContain("engineering_calc")
    expect(loadout.active()).not.toContain("blueprint_edit")
  })

  test("loading an editing tool pulls the siblings needed to check the work", () => {
    const loadout = createLoadout(tools())
    const loaded = loadout.load(["blueprint_edit"])
    expect(loaded.sort()).toEqual(["blueprint", "blueprint_check", "blueprint_edit", "blueprint_view"])
  })

  test("the grouping is directional — looking does not pull drawing", () => {
    const loadout = createLoadout(tools())
    expect(loadout.load(["blueprint_view"])).toEqual(["blueprint_view"])
    expect(loadout.active()).not.toContain("blueprint_edit")
  })

  test("resolves spelling drift and searches summaries", () => {
    const loadout = createLoadout(tools())
    expect(loadout.find("blueprint-edit")).toEqual(["blueprint_edit"])
    expect(loadout.find("blueprintEdit")).toEqual(["blueprint_edit"])
    // Substring over the summary, so a model that knows what it wants but not what it is called
    // still lands somewhere useful.
    expect(loadout.find("draw")).toContain("blueprint_edit")
    expect(loadout.find("")).toEqual([])
  })

  test("an unknown name resolves to nothing rather than to the nearest tool", () => {
    // Same rule as repair.ts: a wrong guess runs the wrong tool, and two blueprint tools differ
    // by a few characters while one of them commits to git.
    const loadout = createLoadout(tools())
    expect(loadout.load(["definitely_not_a_tool"])).toEqual([])
  })

  test("eager names start loaded; unknown eager names are ignored", () => {
    const loadout = createLoadout(tools(), { eager: ["blueprint_edit", "gone_away"] })
    expect(loadout.active()).toContain("blueprint_edit")
    expect(loadout.all()).not.toContain("gone_away")
  })

  test("names given as extra core are never deferred", () => {
    // `.jarvis/tools` and plugin-registered tools. A custom tool the model cannot see is a
    // custom tool that does not work, and the repo's own tests say so.
    const loadout = createLoadout({ ...tools(), shout: stub("Uppercase text") }, { core: ["shout"] })
    expect(loadout.active()).toContain("shout")
    expect(loadout.deferred()).not.toContain("shout")
  })

  test("MCP tools stay deferred — that is the payload nobody in this repo chose", () => {
    const loadout = createLoadout(tools(), { core: ["shout"] })
    expect(loadout.deferred()).toContain("mcp_github_create_issue")
  })

  test("an auto tool loads itself once its condition holds", () => {
    let started = false
    const loadout = createLoadout(tools(), { auto: { bash_output: () => started } })
    expect(loadout.active()).not.toContain("bash_output")
    started = true
    expect(loadout.active()).toContain("bash_output")
  })

  test("loadAll is the safety valve — everything on the wire, as before the feature existed", () => {
    const loadout = createLoadout(tools())
    loadout.loadAll()
    expect(loadout.active().sort()).toEqual(loadout.all().sort())
  })

  test("the catalog names every deferred tool and stays stable as tools load", () => {
    const loadout = createLoadout(tools())
    const before = loadout.catalog()
    for (const name of loadout.deferred()) expect(before).toContain(`- ${name}:`)
    expect(before).not.toContain("- read:")
    loadout.load(["blueprint_edit"])
    // A catalog that shrank as tools loaded would change tool_search's description between
    // steps, which is a payload change for nothing.
    expect(loadout.catalog()).toBe(before)
  })

  test("a tool with no hand-written summary gets the first sentence of its own description", () => {
    const catalog = createLoadout(tools()).catalog()
    expect(catalog).toContain("- mcp_github_create_issue: Create an issue on GitHub")
    expect(catalog).not.toContain("returns the number")
  })
})

describe("toolsUsedIn", () => {
  test("finds the tools an assistant turn already called", () => {
    const used = toolsUsedIn([
      { role: "user", content: "draw something" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "on it" },
          { type: "tool-call", toolCallId: "1", toolName: "blueprint_edit", input: {} },
        ],
      },
    ])
    expect(used).toEqual(["blueprint_edit"])
  })

  test("ignores plain-text turns and user messages", () => {
    expect(toolsUsedIn([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }])).toEqual([])
  })
})
