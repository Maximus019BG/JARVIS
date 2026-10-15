---
name: new-agent-tool
description: Add or change a built-in tool for the jarvis terminal agent (tui/src/tools/) with correct permission gating, registration, test and docs. Use when the user asks for a new agent tool, a new capability for the jarvis agent, or edits a file in tui/src/tools/ or tui/src/permission.ts.
---

# New jarvis agent tool

Read `docs/modules/tui/tools/README.md` first, and copy the closest sibling (`read.ts` for read-only, `write.ts` for gated).

## 1. Define `tui/src/tools/<name>.ts`
```ts
import { tool } from "ai"
import { z } from "zod"
import { type ToolContext, ToolError, resolvePath, clip } from "./context.ts"

export const fooTool = (ctx: ToolContext) =>
  tool({
    description: "…what it does and when the model should use it…",
    inputSchema: z.object({ /* … */ }),
    execute: async (input) => { /* … */ },
  })
```
- TUI imports carry the `.ts` suffix.
- Throw `ToolError` for mistakes the model can fix: a bad path, a missing arg.
- Paths go through `resolvePath(ctx, p)` so they stay inside the workspace. Big outputs go through `clip(text, max)`.

## 2. Gate it (REVIEW pass 8)
Built-in tools are **self-gated**: the agent does not wrap them (see `selfGated` in `tui/src/agent/agent.ts`). So:
- **Side effects** (writes, network, processes, spending money): call
  `await ctx.gate.check({ tool: "<key>", title: "<short action>", detail, subject })` before acting, **and** add `<key>: "ask"` to `DEFAULT_RULES` in `tui/src/permission.ts`.
- **Read-only**: no gate is needed. Say so in the doc.
- Never feed untrusted text (web pages, files, webhook payloads, camera input, repo config) into a prompt or an auto-approved path without the user being asked.

## 3. Register
Add `<name>: fooTool(ctx)` to `builtinTools` in `tui/src/tools/index.ts`. Make it conditional if it depends on optional `ctx` fields (`vision`, `ask`, `spawn`).

If it adds config keys, run `cd tui && bun run schema` and commit `tui/jarvis.schema.json` (rule 5).

## 4. Test
Add cases to `tui/test/tools.test.ts`, using its `setup()` helper: a temp `cwd` and `gate: new PermissionGate({}, constantAsker(...))`. Call `(tools.<name> as { execute }).execute(input, {})`. For a gated tool, cover both the allow and deny outcomes. Run `cd tui && bun test && bun run typecheck`.

## 5. Docs
Update `docs/modules/tui/tools/README.md`: add the file to **Files**, the tool and its permission key to **Interfaces**, and bump `Verified:` (see `/sync-docs`). If users configure it, update `tui/README.md` too.
