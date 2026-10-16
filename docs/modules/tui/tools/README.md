# Tools

Code: `tui/src/tools/`, `tui/src/permission.ts` · Verified: 2026-10-15 @ 9d82895

## Purpose
The built-in tools the agent can call (file I/O, shell, search, web fetch, todo, subagents,
calculator, camera), the permission gate every side effect goes through, the deferred-loading
"loadout" that keeps unused schemas off the wire, and per-turn undo/redo snapshots.
User-facing list: [tui/README.md → Tools](../../../../tui/README.md#tools),
[Permissions](../../../../tui/README.md#permissions), [Tool loading](../../../../tui/README.md#tool-loading).

## How it works

**Building the set** (`index.ts` → `builtinTools(ctx, agents)`): always `read`, `write`, `edit`,
`bash`, `glob`, `grep`, `list`, `todo`, `webfetch`, `bash_output`, `engineering_calc`, the
blueprint tools (from `blueprint/tools.ts`) and `code_project` (from `code/tools.ts`).
Conditional: `ask` only when `ctx.ask` exists (interactive UI), `find_item` only when `ctx.ask`
exists and the device is paired, `task` only when `ctx.spawn` exists and some agent is spawnable.
`agent.ts` then applies, in order:
1. `filterTools(tools, agent.tools, agent.defaultTools)`: explicit `true`/`false`, trailing `*`
   prefix patterns, else the default.
2. `gateTools(tools, gate, exempt)`: wraps every tool *not* in `exempt` with a generic
   `gate.check`. Exempt = all built-ins, custom tools, `skill`, `tool_search` (they gate
   themselves or need no gate). MCP tools report as tool `mcp`, subject = name without `mcp_`.
3. `portableSchemas`: rewrites draft-07 tuple `items: [a, b]` to `items` + `minItems`/`maxItems`
   because vLLM validates against 2020-12 and rejects tuple arrays.

**Permission gate** (`permission.ts` → `PermissionGate.check`):
1. `observe(request)` (UI keeps the diff for display).
2. Plugin override (`permission.ask` hook), else `resolvePermission(rules, request)`: keys are
   `tool` or `tool:prefix`; `*` matches any tool; longest matching prefix wins; fallback `allow`.
   `prefixMatches` makes an **allow** prefix stricter for the two subjects a model can shape: a
   `bash` prefix doesn't match when the rest of the command contains `; & | $ \` < >` or a
   newline, and a `webfetch` prefix must spell out the whole origin (and the URL must start with
   its own origin, so `https://a.com@evil.tld` doesn't pass as `a.com`). `ask`/`deny` prefixes
   keep plain prefix matching.
3. `deny` throws `PermissionDenied`; `allow` returns; `ask` checks the shared `granted` set
   (`tool:subject`), then calls the asker. `always` adds to `granted` and calls `onGrant`.
Rules are `DEFAULT_RULES` overlaid with `config.permission`, then `withRules(agent.permission)`.
Derived gates share the `granted` set, so "always" survives agent switches.

**File safety** (`context.ts`): `resolvePath` refuses any path outside `ctx.cwd`, compared after
resolving symlinks (`realPath`, through the nearest existing ancestor for files not written
yet), so a link in the repo pointing elsewhere is no way out. `read` records
each file's mtime in `ctx.read` (`markRead`); `edit` refuses a file not in the map or whose mtime
changed since. `write`/`edit` call `snapshot.ts` → `record` before writing, then `check.ts` →
`runChecks`, which runs `config.check` commands for matching globs (with `$FILE` substituted) and
returns only failures; it re-marks the file read so a formatter does not trip the stale check.

**Loadout** (`loadout.ts` → `createLoadout`), used when `config.lazyTools` is on:
- Core (always sent): `CORE_TOOLS` plus custom/plugin tools. Everything else (blueprint tools,
  `code_project`, `engineering_calc`, MCP, `bash_output`, `find_item`) is deferred.
- `eager`: tools already called in the transcript (`toolsUsedIn`), so a reload keeps them.
- `auto`: `bash_output` turns on once `startedBackground()` is true.
- `tool_search` (`tool-search.ts`) lists the deferred catalog in its description; `load` resolves
  names via exact match, `repair.ts` aliases, then word search, and pulls in `GROUPS`
  siblings (`blueprint_edit`/`blueprint_symbol` → `blueprint`, `blueprint_view`, `blueprint_check`).

**Undo** (`snapshot.ts`): the UI calls `beginGroup` before a turn and `endGroup` after; each
group stores each file's first pre-write content (`null` = did not exist). `undo`/`redo`
restore a group and push its inverse.

**Foreground `bash`** (`bash.ts`): spawns `bash -c` detached, i.e. in its own process group, and
on timeout (capped at `MAX_TIMEOUT`, 10 min) or the turn's `abortSignal` (Esc) sends `SIGKILL` to
the whole group, so a command's children die with it.

**Background jobs** (`background.ts`): `bash` with `background: true` → `startBackground`
spawns `bash -c` with stdout/stderr to a log file; `bash_output` reads it and can kill.
`killBackground` runs on TUI exit.

## Files
| File | Responsibility |
|---|---|
| `tui/src/permission.ts` | `PermissionGate`, `resolvePermission`, `DEFAULT_RULES`, `PermissionDenied`, `constantAsker`, request/answer types |
| `tui/src/tools/index.ts` | `builtinTools`, `gateTools`, `filterTools`, `portableSchema(s)`, re-exports `ToolError`, `MAX_DEPTH` |
| `tui/src/tools/context.ts` | `ToolContext`, `ToolError`, `resolvePath`, `markRead`, `displayPath`, `clip` |
| `tui/src/tools/ask.ts` | `ask`: multiple-choice question to the user |
| `tui/src/tools/background.ts` | `bash_output`, `startBackground`, `startedBackground`, `killBackground` |
| `tui/src/tools/bash.ts` | `bash` |
| `tui/src/tools/calc.ts` | `engineering_calc` over [engineering](../engineering/README.md) formulas |
| `tui/src/tools/check.ts` | `runChecks`: post-write `config.check` commands |
| `tui/src/tools/edit.ts` | `edit` (single or multi replacement, one diff prompt) |
| `tui/src/tools/glob.ts` | `glob`, shared `IGNORED` directory set |
| `tui/src/tools/grep.ts` | `grep` (ripgrep if on PATH, else `grep -rnI`) |
| `tui/src/tools/list.ts` | `list`: indented tree |
| `tui/src/tools/loadout.ts` | `createLoadout`, `CORE_TOOLS`, `toolsUsedIn`, `TOOL_SEARCH` |
| `tui/src/tools/read.ts` | `read` |
| `tui/src/tools/snapshot.ts` | Per-session undo/redo: `beginGroup`, `record`, `endGroup`, `undo`, `redo`, `clearSnapshots` |
| `tui/src/tools/task.ts` | `task` (subagent delegation), `MAX_DEPTH = 1` |
| `tui/src/tools/todo.ts` | `todo` |
| `tui/src/tools/tool-search.ts` | `tool_search` |
| `tui/src/tools/vision.ts` | `find_item`: webcam snapshot matched on the paired cloud; then `ctx.showItems` opens the live identify screen |
| `tui/src/tools/webfetch.ts` | `webfetch`, `textFromHtml` |
| `tui/src/tools/write.ts` | `write` |

## Interfaces

**Agent tools** (blueprint tools are documented in [blueprint-system](../blueprint-system/README.md)):

| Tool | Parameters | Gate (`tool` / `subject`) | Limits |
|---|---|---|---|
| `read` | `filePath`, `offset?`, `limit?` | none | 2000 lines, 2000 chars/line |
| `write` | `filePath`, `content` | `write` / path | runs checks |
| `edit` | `filePath`, `oldString?`, `newString?`, `replaceAll?`, `edits?[]` | `edit` / path, diff | must have read; runs checks |
| `bash` | `command`, `description?`, `timeout?` (ms, default 120000, max 600000), `background?` | `bash` / command | 60k chars per stream |
| `bash_output` | `id`, `kill?` | none | 30k chars |
| `glob` | `pattern`, `path?` | none | 200 results |
| `grep` | `pattern`, `path?`, `include?` | none | 200 lines, rg `--max-count 20` per file |
| `list` | `path?`, `depth?` (default 2) | none | 400 entries, hides dotfiles |
| `todo` | `todos?[{text, status}]` | none | in memory per session |
| `webfetch` | `url` (http/https) | `webfetch` / URL, again for every redirect hop | 20 s total, 5 redirects, 40k chars |
| `engineering_calc` | `formula?`, `inputs?`, `search?` | none | — |
| `ask` | `question`, `options[2..6]` | none | interactive only |
| `task` | `agent`, `prompt`, `description` | none | depth ≤ 1 |
| `find_item` | `item?` | `find_item` / item name | paired + interactive only |
| `tool_search` | `names?[]`, `query?` | none | only when tools are deferred |

**Default permission rules** (`DEFAULT_RULES`): `write`, `edit`, `bash`, `mcp`, `webfetch`,
`code_project`, `find_item` → `ask`; `task` → `allow`; anything unlisted → `allow`. A test
(`DEFAULT_RULES` in `tools.test.ts`) fails when a built-in tool is neither in `DEFAULT_RULES` nor
in its list of tools that are safe to run unasked. Config: `permission` (e.g.
`"bash:git ": "allow"`, `"mcp:github_": "allow"`, `"webfetch:https://docs.example.com/": "allow"`), agent
`permission`, agent `tools`/`defaultTools`, `check`, `lazyTools`, `vision.threshold`.

**Env passed to child processes**: `bash`, background jobs and checks run with `JARVIS=1`.

## Data and state
- Background job logs: `~/.local/share/jarvis/logs/<sessionID>-bg<n>.log` (outside the
  workspace, so `read` cannot reach them; `bash_output` reads them).
- In memory only, lost on exit: undo/redo stacks (`snapshot.ts`), todo lists (`todo.ts`),
  background jobs map, the gate's `granted` set, the `read` mtime map (owned by the caller).
- "Always" grants are written to `.jarvis/jarvis.jsonc` only when `persistGrants` is on; that
  write lives in `ui/use-turn.ts` via `config/persist.ts` → `persistPermission`.

## Depends on / used by
- Depends on: `blueprint/tools.ts`, `blueprint/credentials.ts` (`isPaired`, `readCredentials`),
  `code/tools.ts`, `engineering/formulas.ts`, `pi/camera.ts` and `pi/items-client.ts`
  (`find_item`), `extend/mcp.ts` (`MCP_PREFIX`), `agent/repair.ts`, `config/paths.ts`.
- Used by: [agent](../agent/README.md) (`agent.ts`), [extensions](../extensions/README.md)
  (`ToolContext`, `ToolError`, `ToolSet`), `blueprint/*-tool.ts`, `code/tools.ts`,
  [UI](../ui/README.md) (`use-turn.ts` for undo/redo, `start.tsx` for `killBackground`,
  `ui/components/dialog.tsx` for permission types), [cli](../cli/README.md) (`constantAsker`).

## Gotchas
- Only gated calls can be refused. Built-ins are exempt from `gateTools`, so a built-in that does
  not call `ctx.gate.check` itself is never gated. `task` never checks, so a `task` rule in config
  has no effect.
- `edit` replaces with a function (`() => newString`), because a string replacement expands
  `$&`, `$$` and `$'`.
- Foreground `bash` output is buffered whole, then clipped (`ponytail:` in `bash.ts`).
- `bash_output` with `kill: true` is ungated.
- Custom tools (`.jarvis/tools`) gate with their own name, which falls through to `allow` unless
  configured.
- The grant key is `tool:subject`. For `bash` the subject is the full command, so "always" only
  re-allows that exact command.
- `edit` on a file the agent wrote itself works because `write` calls `markRead`.
- `runChecks` runs per write, so a project-wide typecheck repeats on multi-file turns
  (`ponytail:` in `check.ts`).
- Undo stacks die with the process (`ponytail:` in `snapshot.ts`). `clearSnapshots` has no
  production callers, and nothing ever removes a session's todo list or a background job, so the
  snapshot, todo and job maps grow for the life of the process. The status line shows no job count.
- Deferred loading must never break a turn: on the last unknown-tool retry `agent.ts` calls
  `loadout.loadAll()`. With `lazyTools: false` the request is identical to before loadouts.
- `tool_search`'s catalog includes loaded tools too, so its description never changes between
  steps (stable payload for prompt caching).

## Tests
Run from `tui/`: `bun test`.

| Test | Covers |
|---|---|
| `tui/test/tools.test.ts` | `portableSchemas`, `resolvePath` (incl. symlink escape), `ask`, `edit` (incl. `$` sequences), `write`, stale reads, multi-edit, `check`, `todo`, `webfetch` (incl. redirect re-gating), `bash` (incl. process-group kill), `glob`/`grep`, `resolvePermission` (incl. chained bash, webfetch origins), `DEFAULT_RULES` coverage, gate observe, `filterTools` (plus blueprint tools) |
| `tui/test/loadout.test.ts` | `loadout.ts`, `tool_search` |
| `tui/test/snapshot.test.ts` | `snapshot.ts` undo/redo |
| `tui/test/mcp.test.ts` | `gateTools` on MCP tools |
| `tui/test/repair.test.ts` | repair against a loadout |
| `tui/test/agent.test.ts` | denied permissions inside a turn |
| `tui/test/remote-approval.test.ts` | permission request shape sent remotely |
