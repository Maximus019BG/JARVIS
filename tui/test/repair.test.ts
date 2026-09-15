import { describe, expect, test } from "bun:test"
import { NoSuchToolError, InvalidToolInputError } from "ai"
import { resolveToolName, toolCallRepair } from "../src/agent/repair.ts"
import type { Loadout } from "../src/tools/loadout.ts"

const REGISTERED = [
  "bash",
  "blueprint",
  "blueprint_check",
  "blueprint_edit",
  "blueprint_symbol",
  "read",
  "webfetch",
  "mcp_jarvis_device_list",
]

describe("resolveToolName", () => {
  test("maps the names a model reaches for onto the tool that exists", () => {
    // `browse` is the one that actually cost a turn; the rest are the same wish, spelled
    // differently.
    for (const name of ["browse", "browser", "fetch", "web_fetch", "web_search", "open_url"]) {
      expect(resolveToolName(name, REGISTERED)).toEqual({ tool: "webfetch" })
    }
  })

  test("carries the action across when the name was an action all along", () => {
    expect(resolveToolName("blueprint_place", REGISTERED)).toEqual({ tool: "blueprint_symbol", action: "place" })
    expect(resolveToolName("blueprint_create", REGISTERED)).toEqual({ tool: "blueprint", action: "create" })
  })

  test("reconciles the cloud server's plural spelling", () => {
    expect(resolveToolName("blueprint_symbols", REGISTERED)).toEqual({ tool: "blueprint_symbol" })
  })

  test("forgives case, separators and the mcp prefix", () => {
    expect(resolveToolName("webFetch", REGISTERED)).toEqual({ tool: "webfetch" })
    expect(resolveToolName("web-fetch", REGISTERED)).toEqual({ tool: "webfetch" })
    expect(resolveToolName("jarvis_device_list", REGISTERED)).toEqual({ tool: "mcp_jarvis_device_list" })
  })

  // The half that matters more than the matching: everything it refuses to guess at.
  test("refuses anything it would have to guess", () => {
    expect(resolveToolName("teleport", REGISTERED)).toBeUndefined()
    // One character out, and one of the candidates commits to git. Fuzzy matching here would
    // run the wrong tool silently; the retry loop is the safer fallback.
    expect(resolveToolName("blueprint_chek", REGISTERED)).toBeUndefined()
    expect(resolveToolName("blueprint_verify", REGISTERED)).toBeUndefined()
  })

  test("refuses an alias whose target this agent is not offered", () => {
    // `webfetch` can be turned off by an agent's tool policy, and a repair must respect that.
    expect(resolveToolName("browse", ["read", "bash"])).toBeUndefined()
  })
})

describe("toolCallRepair", () => {
  const tools = Object.fromEntries(REGISTERED.map((name) => [name, {}]))

  const attempt = (toolName: string, input = "{}", error: unknown = new NoSuchToolError({ toolName })) =>
    toolCallRepair()({ toolCall: { type: "tool-call", toolCallId: "c1", toolName, input }, tools, error } as never)

  test("rewrites the name and keeps the arguments", async () => {
    const repaired = await attempt("browse", '{"url":"https://example.com"}')
    expect(repaired).toMatchObject({ toolCallId: "c1", toolName: "webfetch", input: '{"url":"https://example.com"}' })
  })

  test("injects the action the name was standing in for, as JSON text", async () => {
    const repaired = await attempt("blueprint_place", '{"name":"lamp","symbol":"lamp"}')
    expect(repaired?.toolName).toBe("blueprint_symbol")
    expect(JSON.parse(repaired!.input)).toEqual({ action: "place", name: "lamp", symbol: "lamp" })
  })

  test("never overwrites an action the model did supply", async () => {
    const repaired = await attempt("blueprint_place", '{"action":"list","query":"lamp"}')
    expect(JSON.parse(repaired!.input)).toEqual({ action: "list", query: "lamp" })
  })

  test("passes through arguments that are not an object", async () => {
    expect((await attempt("blueprint_place", '"lamp"'))?.input).toBe('"lamp"')
    expect((await attempt("blueprint_place", "not json"))?.input).toBe("not json")
  })

  test("declines a name it cannot place", async () => {
    expect(await attempt("teleport")).toBeNull()
  })

  // The hook fires for bad arguments too. Repairing those would match the name to itself and
  // hand back the same failing call, having announced a fix that changed nothing.
  test("ignores a bad-arguments error, which is not its job", async () => {
    const error = new InvalidToolInputError({ toolName: "read", toolInput: "{}", cause: new Error("bad") })
    expect(await attempt("read", "{}", error)).toBeNull()
  })

  // Under deferred loading the repair hook sees only the tools on the wire, so a real tool
  // that has not been loaded arrives looking exactly like a hallucinated one.
  describe("with tools left off the wire", () => {
    const loadout = (active: string[]): Loadout =>
      ({
        active: () => active,
        all: () => [...REGISTERED, "tool_search"],
        deferred: () => REGISTERED.filter((name) => !active.includes(name)),
        catalog: () => "",
        load: () => [],
        loadAll: () => {},
        find: () => [],
        has: () => true,
      }) as Loadout

    const onWire = { read: {}, bash: {}, tool_search: {} }
    const attempt = (name: string, active = ["read", "bash", "tool_search"]) =>
      toolCallRepair(undefined, loadout(active))({
        toolCall: { type: "tool-call", toolCallId: "c1", toolName: name, input: '{"name":"x"}' },
        tools: onWire,
        error: new NoSuchToolError({ toolName: name }),
      } as never)

    test("turns a call to a real but unloaded tool into the load it needed", async () => {
      const repaired = await attempt("blueprint_edit")
      expect(repaired?.toolName).toBe("tool_search")
      expect(JSON.parse(repaired!.input)).toEqual({ names: ["blueprint_edit"] })
    })

    test("resolves the alias first, then loads what it resolved to", async () => {
      // `blueprint_place` is not a tool at all; it means blueprint_symbol, which is deferred.
      const repaired = await attempt("blueprint_place")
      expect(JSON.parse(repaired!.input)).toEqual({ names: ["blueprint_symbol"] })
    })

    test("still prefers a loaded tool over a load", async () => {
      const repaired = await attempt("browse", ["read", "bash", "webfetch", "tool_search"])
      expect(repaired?.toolName).toBe("webfetch")
    })

    test("declines a name that is not a tool under any spelling", async () => {
      expect(await attempt("teleport")).toBeNull()
    })

    test("says which tool it is loading, rather than doing it quietly", async () => {
      const seen: [string, string][] = []
      await toolCallRepair((from, to) => seen.push([from, to]), loadout(["read", "tool_search"]))({
        toolCall: { type: "tool-call", toolCallId: "c1", toolName: "blueprint_edit", input: "{}" },
        tools: onWire,
        error: new NoSuchToolError({ toolName: "blueprint_edit" }),
      } as never)
      expect(seen[0]?.[1]).toContain("blueprint_edit")
    })
  })

  test("reports what it rewrote, rather than doing it quietly", async () => {
    const seen: [string, string][] = []
    const repair = toolCallRepair((from, to) => seen.push([from, to]))
    await repair({
      toolCall: { type: "tool-call", toolCallId: "c1", toolName: "browse", input: "{}" },
      tools,
      error: new NoSuchToolError({ toolName: "browse" }),
    } as never)
    expect(seen).toEqual([["browse", "webfetch"]])
  })
})
