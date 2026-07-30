# jarvis

A terminal coding agent, in TypeScript on Bun. Chat with a model, let it read and
edit your workspace, approve anything that changes files. Every part of it —
providers, models, agents, prompts, commands, skills, custom tools, plugins,
themes, keybinds, MCP servers — is data on disk, not code you have to fork.

## Install

```bash
./install.sh
```

Builds a self-contained binary and puts it in `~/.local/bin/jarvis`, then seeds
`~/.config/jarvis/jarvis.jsonc` if you do not have one yet. Works the same on macOS
and Linux; needs `bun` on PATH to build. After that, `jarvis` runs anywhere.

```
./install.sh --prefix /usr/local/bin   install somewhere else
./install.sh --uninstall               remove the binary, keep the config
```

The binary is compiled on the machine you run the script on, because bun embeds the
host platform's `libopentui` into it — a Linux binary has to be built on Linux.

From a checkout you can also just run it: `bun install && bun run start`.

## Commands

```
jarvis                       start the interactive TUI
jarvis run <prompt...>       run one prompt headlessly and print the result
jarvis init                  scaffold a .jarvis directory in this project
jarvis models                list configured models
jarvis config                show config files, agents, tools, skills and plugins

-m, --model <provider/model> override the model
-a, --agent <name>           override the agent
-c, --continue               resume the most recent session in this directory
-s, --session <id>           resume a specific session
-y, --yes                    auto-approve tool permissions (headless)
-v, --version                show the version
```

## The `.jarvis` directory

`jarvis init` scaffolds one, with a working example of every extension point:

```
.jarvis/
  agents/<name>.md          an agent: frontmatter settings, body is its prompt
  commands/<name>.md        a /command, with $ARGUMENTS
  skills/<name>/SKILL.md    instructions the model loads only when it needs them
  tools/<name>.ts           a real tool, written in TypeScript
  plugins/<name>.ts         hooks into the agent loop
  themes/<name>.json        colors
  jarvis.json[c]            config, same schema as the root file
  package.json              deps for your tools and plugins (`cd .jarvis && bun install`)
```

Every subdirectory also works under its singular name (`agent/`, `tool/`, …), and
everything above works identically in `~/.config/jarvis/` to apply globally.

jarvis walks from the git root down to your working directory, so a `.jarvis` in a
subpackage layers on top of the one at the repo root and the nearest definition of a
name wins. `/extensions` in the TUI shows what actually got loaded, and
`jarvis config` shows the same from the shell.

## Configuration

Config is JSONC and merges from the outside in — global first, then for every
directory from the git root down to your working directory its `jarvis.jsonc` and
then its `.jarvis/jarvis.json`. The nearest file wins.

```
~/.config/jarvis/jarvis.jsonc     applies everywhere
<repo>/jarvis.jsonc               applies inside that repo
<repo>/.jarvis/jarvis.json        same, if you prefer it out of the way
<repo>/sub/dir/jarvis.jsonc       applies inside that subtree
```

Any string value can pull in a secret without hardcoding it:

- `{env:ANTHROPIC_API_KEY}` — an environment variable, empty if unset
- `{file:secrets/key.txt}` — file contents, trimmed, relative to the config file

Run `bun run schema` to regenerate `jarvis.schema.json` for editor completion, and
point `$schema` at it.

### Providers and models

There is no bundled provider list. Name any npm package that exports an AI SDK
provider factory and jarvis installs it on first use into
`~/.local/share/jarvis/packages`.

```jsonc
{
  "model": "anthropic/claude-opus-4-5",
  "provider": {
    "anthropic": {
      "npm": "@ai-sdk/anthropic",
      "options": { "apiKey": "{env:ANTHROPIC_API_KEY}" },
      "models": {
        "claude-opus-4-5": { "name": "Claude Opus 4.5", "cost": { "input": 5, "output": 25 } }
      }
    },
    "gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "name": "gateway", "baseURL": "https://example.com/api", "apiKey": "{env:GATEWAY_KEY}" },
      "models": { "some-vendor/some-model": {} }
    }
  }
}
```

Model ids are `provider/model`, split on the **first** slash — so a model id may
itself contain slashes. `options` goes straight to the provider factory;
`cost` is per million tokens and only drives the status-line estimate. Set
`export` if the package's factory is not the first `create*` export.

### Agents

Two are built in: `build` (everything) and `plan` (read-only). Add your own in
config, or as markdown in `.jarvis/agents/<name>.md` — frontmatter is settings, the
body is the system prompt.

```markdown
---
description: Reviews diffs for correctness
model: anthropic/claude-sonnet-4-5
tools: { write: false, edit: false }
temperature: 0.2
---

You review code. Report only defects you can point at a line for.
```

Agents are switchable in the TUI and callable from any agent through the `task`
tool, which runs them with their own context window. Subagents cannot spawn
subagents.

### Commands

`.jarvis/commands/<name>.md` becomes `/<name>`. `$ARGUMENTS` is replaced with the
rest of the line; without it, the arguments are appended.

```markdown
---
description: Review a file
agent: plan
---

Review $ARGUMENTS and list anything that would break in production.
```

### Skills

`.jarvis/skills/<name>/SKILL.md` holds instructions the model loads on demand. It
sees every skill's name and description up front; the body only arrives when it calls
the `skill` tool. That keeps long, situational context out of every prompt.

```markdown
---
name: deploy
description: How to ship this service
---

Run the pipeline, wait for the smoke tests, then tag the release.
```

`name` must be lowercase alphanumeric with single hyphens and match the directory
name. Other files in the skill directory are listed to the model so it can read them.
Access is gated like any tool: `"permission": { "skill:deploy": "ask" }`.

### Custom tools

`.jarvis/tools/<name>.ts` becomes a real tool. The default export is named after the
file; a named export `bar` in `foo.ts` becomes `foo_bar`.

Arguments can be a plain JSON Schema — no dependencies, nothing to install:

```ts
export default {
  description: "Count the lines in a file",
  args: {
    type: "object",
    properties: { path: { type: "string", description: "File to count" } },
    required: ["path"],
  },
  async execute(args: { path: string }, context: { directory: string }) {
    return `${(await Bun.file(`${context.directory}/${args.path}`).text()).split("\n").length} lines`
  },
}
```

or zod, if you `cd .jarvis && bun add zod` — either a record of schemas or a single
`inputSchema: z.object({...})`. `context` carries `agent`, `sessionID`, `messageID`,
`directory`, `worktree` and `abort`.

Custom tools go through the permission gate under their own name, so
`"permission": { "myTool": "ask" }` works.

### Plugins

`.jarvis/plugins/<name>.ts` exports functions that are called once at startup and
return hooks. Each receives `{ directory, worktree, config, $ }` — `$` is Bun's shell.

```ts
export const AllowReadOnlyGit = async () => ({
  "permission.ask": async (input, output) => {
    if (input.tool === "bash" && /^git (status|diff|log)\b/.test(input.subject ?? "")) {
      output.status = "allow"
    }
  },
})
```

| Hook | Can |
|---|---|
| `tool.execute.before(input, output)` | mutate `output.args`, or throw to refuse the call |
| `tool.execute.after(input, output)` | mutate `output.output` before the model sees it |
| `permission.ask(input, output)` | set `output.status` to `allow`/`deny`/`ask`, skipping the prompt |
| `chat.message(input, output)` | rewrite `output.messages` before they are sent |
| `event(input)` | observe every agent event |
| `tool` | an object of extra tools, same shape as `tools/*.ts` |

Hooks apply to built-in, custom and MCP tools alike. A plugin that fails to load is
reported in `/extensions` and skipped — it never takes the session down.

### Instructions

`JARVIS.md` and `AGENTS.md` are picked up from the git root down to your working
directory and appended to the system prompt, nearest last. Extra files (globs
allowed) go in `instructions`.

### Permissions

Every tool that changes something routes through one gate. `write`, `edit` and
`bash` ask by default.

```jsonc
{
  "permission": {
    "bash": "ask",
    "bash:git ": "allow",   // longest matching prefix wins
    "write": "allow",
    "*": "ask"
  }
}
```

`ask` in the TUI prompts with a diff or the command; `y` allows once, `a` allows
that exact call for the session, `n` rejects and tells the model why. Headless
runs deny unless you pass `--yes`. Agents can tighten this with their own
`permission` block.

### Themes

`"theme": "jarvis"` or `"light"`, or drop a `themes/<name>.json` in any `.jarvis`
directory overriding any subset of the tokens in [src/theme.ts](src/theme.ts).
`/theme` switches at runtime.

### Keybinds

```jsonc
{ "keybinds": { "interrupt": "ctrl+g", "newline": "ctrl+j" } }
```

Defaults: `enter` send, `shift+enter` newline, `escape` interrupt, `ctrl+c`
quit, `ctrl+p` commands, `ctrl+o` model, `tab` agent, `ctrl+r` sessions,
`ctrl+t` insert file path, `ctrl+n` new session, `ctrl+l` clear.

### MCP servers

```jsonc
{
  "mcp": {
    "local-thing": { "type": "local", "command": ["bunx", "some-mcp-server"] },
    "remote-thing": { "type": "remote", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer {env:TOKEN}" } }
  }
}
```

Their tools appear as `mcp_<server>_<tool>`. A server that fails to start is
reported by `/mcp` and skipped — it never blocks startup.

## Sessions

Every conversation is append-only JSONL under
`~/.local/share/jarvis/sessions/`. `--continue` resumes the newest session for the
current directory, `--session <id>` a specific one, and `ctrl+r` picks from a list.

## Tools

`read`, `write`, `edit`, `bash`, `glob`, `grep`, `list`, `task`, plus `skill` when
skills exist, anything in `.jarvis/tools/`, and every MCP tool. Paths are resolved
against the workspace root and rejected if they escape it; `edit` requires the file to
have been read first and refuses an ambiguous match.

Agents pick from that set with a `tools` policy, and a trailing `*` matches by prefix:

```yaml
tools:
  write: false
  mcp_*: false
```

## Layout

```
src/
  index.tsx      CLI entry and argument parsing
  config.ts      schema, merge, {env:}/{file:} expansion
  discover.ts    project root, .jarvis directories, plural/singular resolution
  provider.ts    dynamic @ai-sdk/* loading and model resolution
  agent.ts       the streaming tool loop
  agent-def.ts   agent definitions from builtins, markdown and config
  extensions.ts  loads custom tools, skills and plugins once at startup
  skill.ts       skill discovery and frontmatter validation
  plugin.ts      plugin loading, hook dispatch, tool wrapping
  prompt.ts      system prompt and instruction files
  permission.ts  the single approval gate
  session.ts     JSONL persistence
  mcp.ts         MCP clients wrapped as tools
  command.ts     slash commands
  init.ts        the `jarvis init` scaffold
  theme.ts       color tokens
  keybinds.ts    keymap
  tools/         one file per built-in tool, plus custom.ts and skill.ts
  ui/            opentui/react components
```

`bun test` covers config merging and precedence, directory discovery, tool guards,
the permission gate, the agent loop against a mock model, custom tools in each
supported argument shape, skills, every plugin hook, session round-trips, MCP over a
real stdio server, and the transcript reducer.
