import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * Scaffolds a `.jarvis` directory. Every file is a working example of one extension
 * point, so the folder explains itself; nothing is ever overwritten.
 */
const FILES: Record<string, string> = {
  "package.json": `${JSON.stringify(
    {
      name: "jarvis-workspace",
      private: true,
      description: "Dependencies for this project's jarvis tools and plugins. Run `bun install` here.",
    },
    null,
    2,
  )}\n`,

  "tsconfig.json": `${JSON.stringify(
    {
      compilerOptions: {
        lib: ["ESNext"],
        target: "ESNext",
        module: "Preserve",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        strict: true,
        noEmit: true,
        types: ["bun"],
      },
    },
    null,
    2,
  )}\n`,

  ".gitignore": "node_modules\n",

  "agents/example.md": `---
description: Example agent. Delete this or make it your own.
# model: anthropic/claude-sonnet-4-5
# temperature: 0.2
tools:
  write: false
  edit: false
---

You are an example agent. Everything below the frontmatter becomes your system
prompt, appended to jarvis's base prompt.

Pick this agent with the agent picker (tab), or delegate to it with the \`task\` tool.
`,

  "commands/example.md": `---
description: Example command. Run it with /example
# agent: plan
---

Explain what $ARGUMENTS does and how it is used in this project.
`,

  "skills/example/SKILL.md": `---
name: example
description: Example skill. Explains how skills work in jarvis.
---

# example

Skills are instructions the model loads only when it needs them. jarvis shows the
model every skill's name and description up front, and the body of this file is
returned when it calls the \`skill\` tool with \`name: "example"\`.

Put anything a task needs here: a checklist, a house style, an API's quirks. Extra
files in this directory are listed to the model so it can read them.

## When to use

- The instructions are long and only matter for one kind of task
- You would otherwise paste the same context into every prompt
`,

  "tools/example.ts": `// Custom tools. The default export becomes the tool \`example\`; a named export
// \`foo\` would become \`example_foo\`.
//
// \`args\` accepts a plain JSON Schema (as below, no dependencies needed), a record of
// zod schemas, or a single z.object(...). Use \`inputSchema\` if you prefer that name.

export default {
  description: "Count the lines in a file. Replace this with something useful.",
  args: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to count, relative to the project" },
    },
    required: ["path"],
  },
  async execute(args: { path: string }, context: { directory: string }) {
    const file = Bun.file(\`\${context.directory}/\${args.path}\`)
    if (!(await file.exists())) throw new Error(\`no such file: \${args.path}\`)
    return \`\${(await file.text()).split("\\n").length} lines\`
  },
}
`,

  "plugins/example.ts": `// Plugins hook into the agent loop. Every exported function is called once at
// startup and returns an object of hooks.
//
// Available hooks:
//   tool.execute.before(input, output)  mutate output.args, or throw to refuse
//   tool.execute.after(input, output)   mutate output.output
//   permission.ask(input, output)       set output.status to "allow" | "deny" | "ask"
//   chat.message(input, output)         mutate output.messages before they are sent
//   event(input)                        observe every agent event
//   tool                                extra tools, same shape as tools/*.ts

export const ExamplePlugin = async ({ directory }: { directory: string }) => {
  void directory
  return {
    "permission.ask": async (input: { tool: string; subject?: string }, output: { status?: string }) => {
      // Read-only git commands never need approval.
      if (input.tool === "bash" && /^git (status|diff|log)\\b/.test(input.subject ?? "")) {
        output.status = "allow"
      }
    },
  }
}
`,
}

export type InitResult = { created: string[]; skipped: string[] }

export function init(cwd = process.cwd()): InitResult {
  const root = join(cwd, ".jarvis")
  const created: string[] = []
  const skipped: string[] = []

  for (const [name, content] of Object.entries(FILES)) {
    const path = join(root, name)
    if (existsSync(path)) {
      skipped.push(name)
      continue
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    created.push(name)
  }
  return { created, skipped }
}
