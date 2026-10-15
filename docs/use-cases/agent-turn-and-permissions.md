# Agent turn and permissions

Modules: [tui/agent](../modules/tui/agent/README.md), [tui/tools](../modules/tui/tools/README.md), [tui/ui](../modules/tui/ui/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why
A developer types a prompt into `jarvis` (or runs `jarvis run "<prompt>"` in a script). The agent
reads files, runs commands and edits code in a loop until it has an answer. Every step that
changes the workspace or sends data off the machine passes one permission gate first, so the user
decides what runs.

## Flow
1. **The user sends a prompt.** Plain text starts a turn. `!cmd` runs a shell command without the
   model, and `/name` runs a slash command. If a turn is already running, the prompt is queued and
   sent when the turn ends (`tui/src/ui/app.tsx` → `submit`).
2. **The turn is prepared** (`tui/src/ui/use-turn.ts` → `send`). `@file` mentions become
   attachments (images are capped at 5 MB, workspace files only). The user message is appended to
   the session JSONL, an undo group opens and an abort controller is created.
3. **Cost guard.** With `maxCost > 0`, once the session has spent that much the user is asked
   a `budget` question first. "No" stops the turn. "Yes" moves the next stop to
   `spent + maxCost`.
4. **The agent and model are resolved** (`tui/src/agent/agent.ts` → `run`). The agent is
   `build` unless the user picked another one (left/right on an empty prompt, or `--agent`). The
   model is the `--model` flag, else the agent's own model, else the config default. Then the
   gate is narrowed with the agent's `permission` rules.
5. **The tool set is built.** Built-in tools, plus `skill`, custom `.jarvis/tools` and MCP tools.
   The agent's `tools`/`defaultTools` filter runs next, and any tool that does not gate itself
   (MCP, plugin tools) is wrapped in a generic gate check. With `lazyTools` on (the default),
   only core tools travel with each request and the model loads the rest with `tool_search`.
6. **The model is called.** `streamText` runs with the system prompt, the history and the tools.
   It stops after `maxSteps` steps (default 200). Text, reasoning, tool starts and tool results
   stream into the transcript as they arrive.
7. **Each tool call hits the gate** (`tui/src/permission.ts` → `PermissionGate.check`):
   - A plugin `permission.ask` hook may decide first.
   - Otherwise the most specific matching rule decides: `allow` runs it, `deny` fails it, `ask`
     asks the user, unless "always" was already granted for that exact tool and subject.
   - The prompt plays the `attention` sound and shows the diff or command. Keys: `y`/Enter
     allows once, `a` allows always, `n`/Esc rejects. A thumbs-up or thumbs-down gesture
     answers it too (once / reject).
   - With `remoteApproval` on, the same question also goes to the web and phone, and the first
     answer wins. See [remote-approval-and-steering.md](remote-approval-and-steering.md).
8. **Tool results go back to the model.** A rejected or failed tool becomes a failed tool
   result. The model sees the error text and the turn continues, so it can try something else.
9. **The turn ends** when the model stops calling tools, hits `maxSteps`, or the user presses
   Esc. The response messages are appended to the session, the metrics are recorded, and the
   session gets a generated title once. If prompt tokens exceed 85% of the context window, the
   history is compacted. Then the undo group closes, and `pushSession` and `autoSync` run
   without blocking the next prompt.

**Headless: `jarvis run <prompt>`** (`tui/src/cli/headless.ts` → `runHeadless`). It goes through the
same `run` loop and the same session files (`-c` continues the latest session in this folder,
`-s <id>` continues a specific one). There is nobody to ask, so the gate uses `constantAsker`:
without `-y` every `ask` is rejected, and with `-y` every `ask` is approved. `deny` rules still
refuse. Text goes to stdout, while tool traces, errors and the final token count go to stderr.
`jarvis work` runs automation jobs the same way.

## Business rules
- **Rule values** are `ask`, `allow` and `deny` (`tui/src/config/config.ts` → `PermissionSchema`).
- **Defaults** (`DEFAULT_RULES`): `write`, `edit`, `bash`, `mcp`, `webfetch`, `code_project` and
  `find_item` ask, and `task` is allowed. Any tool not listed is allowed. Read-only tools
  (`read`, `glob`, `grep`, `list`, `todo`) never call the gate.
- **Rule layering:** `DEFAULT_RULES`, then the config's `permission`, then the agent's
  `permission`. Later layers win.
- **Matching:** keys are `tool` or `tool:prefix`, and `*` matches any tool. The longest matching
  prefix wins, and at equal length a named tool beats `*`.
- **Allow prefixes are stricter for `bash` and `webfetch`.** `"bash:git ": "allow"` does not
  match a command that has `; & | $ \` < >` or a newline after the prefix. A `webfetch` allow
  prefix must spell out the whole origin (`https://docs.example.com/`). `ask` and `deny` prefixes
  use plain prefix matching (`tui/src/permission.ts` → `prefixMatches`).
- **Subjects:** `bash` uses the full command, `write`/`edit` the path, `webfetch` the URL
  (checked again on every redirect), `code_project` the action, and MCP tools their name without
  the `mcp_` prefix. Custom tools and skills gate under their own names, so they are allowed
  unless configured.
- **"Always" is narrow.** The grant key is `tool:subject`, so for `bash` it re-allows only that
  exact command. Grants live in memory and survive agent switches, but not a restart. With
  `persistGrants` on (default off), the grant is written to the project's `.jarvis/jarvis.jsonc`.
- **The `plan` agent** turns off only `write`, `edit` and `bash`. Other tools that change things,
  such as `code_project`, blueprint tools and MCP tools, still follow their own rules.
- **Built-in tools gate themselves.** `task` never checks the gate, so a `task` rule has no
  effect. `bash_output` with `kill: true` is not gated.
- **File safety:** every path is resolved after symlinks and must stay inside the working
  directory. `edit` refuses a file that has not been read, or that changed since it was read.
- **Limits:** `bash` times out at 120 s by default and at 600 s at most, and Esc kills its whole
  process group. `ask` (multiple choice) exists only in the interactive UI, and `find_item` only
  when the UI is running and the device is paired.
- **Retries:** at most 2, and only when no tool ran in the failed attempt (Groq
  `failed_generation`, or a provider that rejected an unknown tool name).

## When it fails
- **Rejected or denied:** the tool card shows `permission denied for <tool>`, and the model
  carries on without that tool.
- **Headless without `-y`:** every `ask` tool fails the same way. Add a rule such as
  `"bash:git ": "allow"`, or pass `-y`.
- **Context window full:** the TUI and `jarvis run` compact once and retry. If that fails too,
  the error is shown.
- **The model returns nothing**, or keeps calling tools that do not exist: after the retries,
  an error suggests a stronger model or naming the tool explicitly.
- **Bad API key:** auth-shaped errors are rewritten to name the missing `{env:…}` variable or
  secret, with `/provider view <id>` as the next step.
- **Esc during a turn:** the steps that finished are kept, a half-finished step is dropped, and
  the transcript shows "interrupted". `/undo` reverts the turn's file writes.

## Related
- [Remote approval and steering](remote-approval-and-steering.md): answering the gate from a phone.
- [Model calls and usage](model-calls-and-usage.md): what happens when the model is the hosted one.
- [Code projects](code-projects.md): the `code_project` tool and its `ask` default.
- [Automations](automations.md): `jarvis work` runs jobs through the headless path.
- Module docs: [tui/agent](../modules/tui/agent/README.md), [tui/tools](../modules/tui/tools/README.md),
  [tui/ui](../modules/tui/ui/README.md).
