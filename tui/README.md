# jarvis

A terminal coding agent, in TypeScript on Bun. Chat with a model, let it read and
edit your workspace, approve anything that changes files. Every part of it —
providers, models, agents, prompts, commands, themes, keybinds, MCP servers — is
configuration on disk, not code.

```bash
bun install
bun run start            # interactive TUI
bun run start models     # list configured models
bun run start config     # show which config files are in effect
```

```
jarvis                       start the interactive TUI
jarvis run <prompt...>       run one prompt headlessly and print the result
jarvis models                list configured models
jarvis config                show which config files are in effect

-m, --model <provider/model> override the model
-a, --agent <name>           override the agent
-c, --continue               resume the most recent session in this directory
-s, --session <id>           resume a specific session
-y, --yes                    auto-approve tool permissions (headless)
```

`bun run compile` produces a standalone `dist/jarvis` binary with no runtime
dependency on Bun being installed.

## Configuration

Config is JSONC and merges from the outside in — global first, then every
`jarvis.jsonc` (or `jarvis.json`) from the filesystem root down to your working
directory. The nearest file wins.

```
~/.config/jarvis/jarvis.jsonc     applies everywhere
<repo>/jarvis.jsonc               applies inside that repo
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
config, or as markdown in `.jarvis/agent/<name>.md` — frontmatter is settings, the
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

`.jarvis/command/<name>.md` becomes `/<name>`. `$ARGUMENTS` is replaced with the
rest of the line; without it, the arguments are appended.

```markdown
---
description: Review a file
agent: plan
---

Review $ARGUMENTS and list anything that would break in production.
```

### Instructions

`JARVIS.md` and `AGENTS.md` are picked up from the filesystem root down to your
working directory and appended to the system prompt, nearest last. Extra files
(globs allowed) go in `instructions`.

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

`"theme": "jarvis"` or `"light"`, or drop `~/.config/jarvis/theme/<name>.json`
overriding any subset of the tokens in [src/theme.ts](src/theme.ts).

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

`read`, `write`, `edit`, `bash`, `glob`, `grep`, `list`, `task`. Paths are
resolved against the workspace root and rejected if they escape it; `edit`
requires the file to have been read first and refuses an ambiguous match.

## Layout

```
src/
  index.tsx      CLI entry and argument parsing
  config.ts      schema, merge, {env:}/{file:} expansion
  provider.ts    dynamic @ai-sdk/* loading and model resolution
  agent.ts       the streaming tool loop
  agent-def.ts   agent definitions from builtins, markdown and config
  prompt.ts      system prompt and instruction files
  permission.ts  the single approval gate
  session.ts     JSONL persistence
  mcp.ts         MCP clients wrapped as tools
  command.ts     slash commands
  theme.ts       color tokens
  keybinds.ts    keymap
  tools/         one file per built-in tool
  ui/            opentui/react components
```

`bun test` covers config merging and precedence, tool guards, the permission
gate, the agent loop against a mock model, session round-trips, MCP over a real
stdio server, and the transcript reducer.
