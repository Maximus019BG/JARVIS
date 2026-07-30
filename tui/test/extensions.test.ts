import { beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, type AgentEvent } from "../src/agent.ts"
import { ConfigSchema } from "../src/config.ts"
import { loadExtensions } from "../src/extensions.ts"
import { init } from "../src/init.ts"
import { constantAsker, PermissionGate } from "../src/permission.ts"
import { loadSkills } from "../src/skill.ts"
import { toInputSchema } from "../src/tools/custom.ts"
import type { MockPart } from "./fixtures/mock-provider.ts"

const config = ConfigSchema.parse({
  model: "mock/test",
  provider: {
    mock: { npm: join(import.meta.dir, "fixtures", "mock-provider.ts"), export: "createMock", models: { test: {} } },
  },
})

function repo() {
  const root = mkdtempSync(join(tmpdir(), "jarvis-ext-"))
  mkdirSync(join(root, ".git"))
  return root
}

function put(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

const script = (...steps: MockPart[][]) => {
  globalThis.mockSteps = steps
  globalThis.mockCalls = []
}

/** One turn through the real loop, with whatever `.jarvis` holds in `cwd`. */
async function turn(cwd: string, steps: MockPart[][], allow = true) {
  script(...steps)
  const events: AgentEvent[] = []
  const extensions = await loadExtensions(config, cwd)
  const result = await run({
    config,
    cwd,
    messages: [{ role: "user", content: "go" }],
    gate: new PermissionGate(config.permission, constantAsker(allow)),
    extensions,
    onEvent: (event) => events.push(event),
  })
  return { result, events, extensions }
}

const toolNames = (call: unknown) => ((call as { tools?: { name: string }[] }).tools ?? []).map((tool) => tool.name)
const endOf = (events: AgentEvent[], name: string) =>
  events.find((event) => event.type === "tool-end" && event.name === name) as
    | Extract<AgentEvent, { type: "tool-end" }>
    | undefined

beforeEach(() => script())

describe("toInputSchema", () => {
  test("passes a Standard Schema through and wraps a raw JSON Schema", () => {
    const standard = { "~standard": { version: 1, vendor: "test" } }
    expect(toInputSchema(standard)).toBe(standard)
    expect(toInputSchema({ type: "object", properties: {} })).toHaveProperty("jsonSchema")
  })

  test("assembles a record of JSON Schema fragments, honouring optional", () => {
    const schema = toInputSchema({ a: { type: "string" }, b: { type: "number", optional: true } }) as {
      jsonSchema: { required: string[] }
    }
    expect(schema.jsonSchema.required).toEqual(["a"])
  })

  test("rejects something that is not a schema at all", () => {
    expect(() => toInputSchema("nope")).toThrow()
  })
})

describe("custom tools", () => {
  test("a JSON Schema tool is offered to the model and callable", async () => {
    const cwd = repo()
    put(
      join(cwd, ".jarvis", "tools", "shout.ts"),
      `export default {
         description: "Uppercase text",
         args: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
         async execute(args, context) { return args.text.toUpperCase() + " in " + (context.directory === ${JSON.stringify(cwd)}) }
       }`,
    )
    const { events } = await turn(cwd, [
      [{ type: "tool", id: "c1", name: "shout", input: { text: "hi" } }],
      [{ type: "text", text: "ok" }],
    ])
    expect(toolNames(globalThis.mockCalls[0])).toContain("shout")
    expect(endOf(events, "shout")).toMatchObject({ output: "HI in true", failed: false })
  })

  test("named exports get the file prefix, and a zod record works too", async () => {
    const cwd = repo()
    // What `cd .jarvis && bun install` gives you: dependencies resolvable from the
    // tool file. Without it, importing zod is a load error, by design.
    mkdirSync(join(cwd, ".jarvis"), { recursive: true })
    symlinkSync(join(import.meta.dir, "..", "node_modules"), join(cwd, ".jarvis", "node_modules"))
    put(
      join(cwd, ".jarvis", "tools", "text.ts"),
      `import { z } from "zod"
       export const reverse = {
         description: "Reverse a string",
         args: { value: z.string().describe("the string") },
         async execute(args) { return [...args.value].reverse().join("") }
       }`,
    )
    const { events } = await turn(cwd, [
      [{ type: "tool", id: "c1", name: "text_reverse", input: { value: "abc" } }],
      [{ type: "text", text: "ok" }],
    ])
    expect(endOf(events, "text_reverse")).toMatchObject({ output: "cba" })
  })

  test("a broken tool file is reported and the rest still load", async () => {
    const cwd = repo()
    put(join(cwd, ".jarvis", "tools", "broken.ts"), "this is not valid typescript ((")
    put(
      join(cwd, ".jarvis", "tools", "fine.ts"),
      `export default { description: "ok", async execute() { return "fine" } }`,
    )
    const extensions = await loadExtensions(config, cwd)
    expect(Object.keys(extensions.tools)).toEqual(["fine"])
    expect(extensions.errors.join(" ")).toContain("broken.ts")
  })
})

describe("skills", () => {
  const skill = (cwd: string, name: string, frontmatter: string, body = "Do the thing.") =>
    put(join(cwd, ".jarvis", "skills", name, "SKILL.md"), `---\n${frontmatter}\n---\n${body}\n`)

  test("valid skills load; invalid frontmatter is reported per file", () => {
    const cwd = repo()
    skill(cwd, "good-one", "name: good-one\ndescription: A good skill")
    skill(cwd, "mismatch", "name: other\ndescription: Wrong name")
    skill(cwd, "nodesc", "name: nodesc")
    skill(cwd, "Bad_Name", "name: Bad_Name\ndescription: bad")
    const { skills, errors } = loadSkills(cwd)
    expect(skills.map((entry) => entry.name)).toEqual(["good-one"])
    expect(errors).toHaveLength(3)
  })

  test("the skill tool lists names up front and returns the body on demand", async () => {
    const cwd = repo()
    skill(cwd, "deploy", "name: deploy\ndescription: How to ship", "Run the pipeline, then verify.")
    put(join(cwd, ".jarvis", "skills", "deploy", "checklist.md"), "- one\n")

    const { events } = await turn(cwd, [
      [{ type: "tool", id: "c1", name: "skill", input: { name: "deploy" } }],
      [{ type: "text", text: "ok" }],
    ])
    const offered = (globalThis.mockCalls[0] as { tools: { name: string; description: string }[] }).tools
    const description = offered.find((tool) => tool.name === "skill")?.description ?? ""
    expect(description).toContain("deploy: How to ship")
    expect(description).not.toContain("Run the pipeline")

    const output = endOf(events, "skill")?.output ?? ""
    expect(output).toContain("Run the pipeline, then verify.")
    expect(output).toContain("checklist.md")
  })

  test("the skill tool is absent when there are no skills", async () => {
    const cwd = repo()
    await turn(cwd, [[{ type: "text", text: "ok" }]])
    expect(toolNames(globalThis.mockCalls[0])).not.toContain("skill")
  })
})

describe("plugins", () => {
  test("tool.execute.before rewrites args and after rewrites the result", async () => {
    const cwd = repo()
    put(
      join(cwd, ".jarvis", "plugins", "rewrite.ts"),
      `export const Rewrite = async () => ({
         "tool.execute.before": async (input, output) => {
           if (input.tool === "write") output.args.content = "rewritten by plugin\\n"
         },
         "tool.execute.after": async (input, output) => {
           output.output = output.output + " [seen by plugin]"
         },
       })`,
    )
    const { events } = await turn(cwd, [
      [{ type: "tool", id: "c1", name: "write", input: { filePath: "out.txt", content: "original" } }],
      [{ type: "text", text: "ok" }],
    ])
    expect(await Bun.file(join(cwd, "out.txt")).text()).toBe("rewritten by plugin\n")
    expect(endOf(events, "write")?.output).toContain("[seen by plugin]")
  })

  test("permission.ask can deny without prompting", async () => {
    const cwd = repo()
    put(
      join(cwd, ".jarvis", "plugins", "guard.ts"),
      `export const Guard = async () => ({
         "permission.ask": async (input, output) => {
           if (input.tool === "write") output.status = "deny"
         },
       })`,
    )
    // The asker would allow, so a denial can only come from the plugin.
    const { events } = await turn(
      cwd,
      [[{ type: "tool", id: "c1", name: "write", input: { filePath: "out.txt", content: "x" } }], [{ type: "text", text: "ok" }]],
      true,
    )
    expect(endOf(events, "write")).toMatchObject({ failed: true })
    expect(endOf(events, "write")?.output).toContain("permission denied")
    expect(await Bun.file(join(cwd, "out.txt")).exists()).toBe(false)
  })

  test("chat.message can rewrite the outgoing conversation", async () => {
    const cwd = repo()
    put(
      join(cwd, ".jarvis", "plugins", "prefix.ts"),
      `export const Prefix = async () => ({
         "chat.message": async (input, output) => {
           output.messages = [{ role: "user", content: "PLUGIN REWROTE THIS" }]
         },
       })`,
    )
    await turn(cwd, [[{ type: "text", text: "ok" }]])
    expect(JSON.stringify(globalThis.mockCalls[0])).toContain("PLUGIN REWROTE THIS")
  })

  test("a plugin can register a tool, and a broken plugin is reported", async () => {
    const cwd = repo()
    put(
      join(cwd, ".jarvis", "plugins", "extra.ts"),
      `export const Extra = async () => ({
         tool: { ping: { description: "Ping", async execute() { return "pong" } } },
       })`,
    )
    put(join(cwd, ".jarvis", "plugins", "bad.ts"), `export const Bad = async () => { throw new Error("nope") }`)

    const { events, extensions } = await turn(cwd, [
      [{ type: "tool", id: "c1", name: "ping", input: {} }],
      [{ type: "text", text: "ok" }],
    ])
    expect(endOf(events, "ping")?.output).toBe("pong")
    expect(extensions.errors.join(" ")).toContain("nope")
  })
})

describe("init", () => {
  test("scaffolds a working .jarvis that loads without errors", async () => {
    const cwd = repo()
    const first = init(cwd)
    expect(first.created).toContain("tools/example.ts")
    expect(first.skipped).toEqual([])

    const extensions = await loadExtensions(config, cwd)
    expect(extensions.errors).toEqual([])
    expect(Object.keys(extensions.tools)).toContain("example")
    expect(extensions.skills.map((skill) => skill.name)).toEqual(["example"])
    expect(extensions.plugins.hooks).toHaveLength(1)

    // Running it again must not clobber anything.
    expect(init(cwd).created).toEqual([])
  })

  test("the scaffolded agent and command show up", async () => {
    const cwd = repo()
    init(cwd)
    const { loadAgents } = await import("../src/agent-def.ts")
    const { loadCommands } = await import("../src/command.ts")
    expect(Object.keys(loadAgents(config, cwd))).toContain("example")
    expect(loadCommands(cwd).map((command) => command.name)).toContain("example")
  })
})
