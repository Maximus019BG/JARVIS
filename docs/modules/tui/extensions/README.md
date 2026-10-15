# Extensions

Code: `tui/src/extend/`, `tui/assets/global/` · Verified: 2026-10-14 @ c9135de

## Purpose
Everything a `.jarvis` directory (project or global) can add without forking jarvis: slash
commands, custom tools, skills, plugins with hooks, and MCP servers. Also the global agents and
skills that ship with jarvis and are copied into `~/.config/jarvis` by `install.sh`.
Usage: [tui/README.md → The .jarvis directory](../../../../tui/README.md#the-jarvis-directory),
[Commands](../../../../tui/README.md#commands-1), [Skills](../../../../tui/README.md#skills),
[Custom tools](../../../../tui/README.md#custom-tools), [Plugins](../../../../tui/README.md#plugins),
[MCP servers](../../../../tui/README.md#mcp-servers).

## How it works

All file discovery uses [config](../config/README.md)'s `resourceDirs`/`resourceFiles`: the
global `~/.config/jarvis/<kind>/`, then `.jarvis/<kind>/` from project root down to cwd (singular
or plural folder names), but only for directories the user trusted (`jarvis trust`, D-12).
Nearest wins where names collide.

**Startup** (`extensions.ts` → `loadExtensions`), once per process, in parallel:
- `custom-tools.ts` → `loadCustomTools`: imports every `tools/*.{ts,tsx,js,mjs}`. Each export
  with a string `description` and an `execute` function becomes a tool: default export →
  `<file>`, named export `bar` → `<file>_bar` (`toolNameFor`). `args`/`inputSchema` may be a
  Standard Schema (zod), a JSON Schema object, or a record of either (`toInputSchema`); it is
  validated at load so a bad schema fails at startup, not mid-turn.
- `skill.ts` → `loadSkills`: every `skills/<name>/SKILL.md` with frontmatter `name` (must match
  the folder, lowercase alphanumeric with single hyphens, ≤64 chars) and a non-empty
  `description`. Folders starting with `_` or `.` are skipped.
- `plugin.ts` → `loadPlugins`: imports every `plugins/*.{ts,tsx,js,mjs}` and calls each exported
  function once with `{directory, worktree, config, $}`. The returned object is a hook set; its
  `tool` entries are merged into the custom tools.
Any failure is collected in `errors` and shown, never fatal.

**Per turn** (in `agent/agent.ts`):
1. `customTools(definitions, ctx)` wraps each definition with `dynamicTool`; `execute` first
   calls `ctx.gate.check({tool: <name>})`, then passes a `CustomToolContext`
   (`agent`, `sessionID`, `messageID`, `directory`, `worktree`, `abort`). Non-string results are
   JSON-stringified.
2. `skill-tool.ts` → `skillTool` adds one `skill` tool whose description lists every skill's name
   and description. Calling it gates (`tool: "skill"`), then returns the SKILL.md body plus a list
   of supporting files (up to 40) in the skill folder.
3. `plugin.ts` → `fire` runs `chat.message` before sending, `permission.ask` inside the gate
   override, `event` for every agent event; `wrapTools` applies `tool.execute.before`/`after` to
   every tool (built-in, custom and MCP).

**MCP** (`mcp.ts` → `startMcp`): connects every enabled server in `config.mcp` (stdio for
`local`, Streamable HTTP for `remote`), lists tools, and exposes each as `mcp_<server>_<tool>`.
Content blocks are flattened to text; `isError` results throw. A server that fails is recorded in
`status` and skipped. MCP tools are not self-gated, so `tools/index.ts` → `gateTools` checks them
as tool `mcp` with subject `<server>_<tool>`.

**Commands** (`command.ts` → `loadCommands`): `BUILTIN_COMMANDS` (handled by the UI) plus every
`commands/*.md`. A markdown command's body is a prompt template; frontmatter may set
`description`, `agent`, `model`. `expand` substitutes `$ARGUMENTS`, or appends the arguments
when the template has none. `parseCommandLine` splits `/name args`.

**Shipped assets** (`tui/assets/global/`): not loaded from the repo at runtime. `install.sh`
copies `agents/*.md` into `~/.config/jarvis/agents/` when absent and each skill folder with
`cp -Rn`, after which normal discovery picks them up.

## Files
| File | Responsibility |
|---|---|
| `tui/src/extend/extensions.ts` | `loadExtensions`, `Extensions`, `NO_EXTENSIONS`, `summary` |
| `tui/src/extend/command.ts` | `BUILTIN_COMMANDS`, `loadCommands`, `parseCommandLine`, `expand`, `Command` |
| `tui/src/extend/custom-tools.ts` | `loadCustomTools`, `customTools`, `toInputSchema`, `toolNameFor`, `CustomToolDefinition`, `CustomToolContext` |
| `tui/src/extend/mcp.ts` | `startMcp`, `MCP_PREFIX`, `toolName`, `McpSession`, `McpStatus` |
| `tui/src/extend/plugin.ts` | `loadPlugins`, `fire`, `wrapTools`, `PluginHooks`, `PluginInput`, `NO_PLUGINS` |
| `tui/src/extend/skill.ts` | `loadSkills`, `skillFiles`, `Skill` |
| `tui/src/extend/skill-tool.ts` | `skillTool`: the `skill` agent tool |
| `tui/assets/global/agents/analyst.md` | `analyst` agent: reads usage/logs/metrics; no `write`/`edit` |
| `tui/assets/global/agents/butler.md` | `butler` agent: conversational; no `write`/`edit`/`bash` |
| `tui/assets/global/agents/draftsman.md` | `draftsman` agent: blueprints only; no `write`/`edit`/`bash` |
| `tui/assets/global/agents/mechanic.md` | `mechanic` agent: firmware and hardware bring-up; full tools |
| `tui/assets/global/agents/sentry.md` | `sentry` agent: reports problems without fixing; no `write`/`edit` |
| `tui/assets/global/skills/blueprint-drafting/SKILL.md` | Blueprint fundamentals: tools, coordinates, batching, dimensioning |
| `tui/assets/global/skills/blueprint-drafting/references/entities.md` | Entity and op reference |
| `tui/assets/global/skills/building-blueprints/SKILL.md` | Floor plans, sections, elevations to EN/Eurocode |
| `tui/assets/global/skills/building-blueprints/references/construction.md` | Construction reference |
| `tui/assets/global/skills/building-blueprints/references/physics.md` | Building physics reference |
| `tui/assets/global/skills/building-blueprints/references/standards.md` | Standards reference |
| `tui/assets/global/skills/electrical-schematics/SKILL.md` | IEC schematics, cable sizing, protection |
| `tui/assets/global/skills/electrical-schematics/references/calculations.md` | Calculation reference |
| `tui/assets/global/skills/electrical-schematics/references/standards.md` | Standards reference |
| `tui/assets/global/skills/electrical-schematics/references/symbols.md` | Symbol index |
| `tui/assets/global/skills/iot-blueprints/SKILL.md` | Microcontroller wiring and block diagrams |
| `tui/assets/global/skills/iot-blueprints/references/buses.md` | I2C/SPI/UART conventions |
| `tui/assets/global/skills/iot-blueprints/references/power.md` | Power and battery budgets |
| `tui/assets/global/skills/iot-blueprints/references/symbols.md` | Symbol index |

## Interfaces

**Resource folders** (in `~/.config/jarvis/` or any `.jarvis/`): `agents/*.md` (loaded by
`agent/agent-def.ts`), `commands/*.md`, `skills/<name>/SKILL.md`, `tools/*.{ts,tsx,js,mjs}`,
`plugins/*.{ts,tsx,js,mjs}`, `themes/*.json` (loaded by `config/theme.ts`).

**Plugin hooks** (`PluginHooks`):

| Hook | Arguments | Effect |
|---|---|---|
| `tool.execute.before` | `{tool, sessionID, agent}`, `{args}` | mutate `args` or throw to refuse |
| `tool.execute.after` | `{tool, sessionID, agent}`, `{output}` | rewrite the string the model sees |
| `permission.ask` | `PermissionRequest`, `{status?}` | set `allow`/`deny`/`ask` before the prompt |
| `chat.message` | `{agent, model, sessionID}`, `{messages}` | rewrite outgoing messages |
| `event` | `{event}` | observe every `AgentEvent` |
| `tool` | — | extra tools, same shape as `tools/*.ts` |

**Agent tools**: `skill` (`name`), and `mcp_<server>_<tool>` for each MCP tool.

**Built-in slash commands** (`BUILTIN_COMMANDS`, executed in `ui/builtin-commands.ts`): `help`,
`new`, `clear`, `compact`, `model`, `agent`, `sessions`, `export`, `retry`, `undo`, `redo`,
`theme`, `blueprint`, `code`, `pair`, `mcp`, `provider`, `stats`, `voice`, `speak`, `learn`,
`find`, `items`, `forget`, `gestures`, `tutorial`, `extensions`, `exit`. A markdown command with
the same name replaces the built-in entry.

**Config keys**: `mcp.<name>` (see [config](../config/README.md)).

## Data and state
- No files of its own beyond the resource folders above. Everything is loaded once at startup
  and held in memory (`Extensions`, `McpSession`); edits need a restart.
- MCP `local` servers inherit `process.env` plus `environment`.
- Plugins get Bun's `$` shell and the full `Config`, including resolved secrets.

## Depends on / used by
- Depends on: [config](../config/README.md) (`resourceFiles`, `resourceDirs`, `projectRoot`),
  [tools](../tools/README.md) (`ToolContext`, `ToolError`, `ToolSet`, `PermissionRequest`),
  `@modelcontextprotocol/sdk`, `gray-matter`.
- Used by: [agent](../agent/README.md) (`agent.ts`, `repair.ts` for `MCP_PREFIX`),
  [tools](../tools/README.md) (`index.ts` for `MCP_PREFIX`), [cli](../cli/README.md)
  (`index.tsx`, `headless.ts`), [UI](../ui/README.md) (`start.tsx`, `app.tsx`, `boot.ts`,
  `builtin-commands.ts`, `pickers.ts`, `suggest.ts`, `use-turn.ts`).

## Gotchas
- Custom tools and plugins are code imported into the jarvis process, which is why a repo's
  `.jarvis/` only loads once the repo is trusted. Custom tools gate
  under their own name, which defaults to `allow`; MCP defaults to `ask`.
- `wrapTools` runs `tool.execute.before` before the tool's own gate check, so a plugin can change
  the arguments the user is then asked to approve.
- `skill` returns supporting-file paths relative to the skill folder. Global skills live in
  `~/.config/jarvis/skills/`, outside the workspace, and `read` refuses paths outside cwd, so an
  agent with `bash: false` (`draftsman`, `butler`) cannot open a global skill's `references/`
  files. Only the SKILL.md body reaches it.
- A plugin file runs every exported function as a factory; export helpers from somewhere else.
- `toInputSchema` with a record of foreign zod schemas depends on zod v4 internals
  (`ponytail:` in `custom-tools.ts`); a single `z.object({...})` always works.
- MCP tool names include the server name; rules like `"mcp:github_": "allow"` match on it.
- Shipped agents are copied only when absent, and skill files with `cp -Rn`, so edited copies are
  never overwritten and updates to an existing file never arrive. Delete the copy and re-run
  `install.sh` to get the new version.

## Tests
Run from `tui/`: `bun test`.

| Test | Covers |
|---|---|
| `tui/test/extensions.test.ts` | custom tools, skills, plugins, `init` scaffold, hooks inside `run` |
| `tui/test/mcp.test.ts` | `startMcp`, MCP tool gating |
| `tui/test/discover.test.ts` | markdown commands and agents from `.jarvis` |
| `tui/test/boot.test.ts` | extension counts and errors in the UI boot report |
| `tui/test/ui.test.ts` | command list (`describe("commands")`) |
