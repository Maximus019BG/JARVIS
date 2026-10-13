# MCP

Code: `web/src/server/mcp/`, `web/src/app/api/mcp/`, `web/src/app/api/device/mcp-token/` · Verified: 2026-10-13 @ c292f2f

## Purpose
JARVIS cloud as an MCP server, so an MCP client (Claude Code, Cursor, the JARVIS TUI) can read and
change one workstation's blueprints and automations. Auth is the same `jvd_` device token the TUI
uses; what a token may do is its `device.scopes`. An MCP token is just a `device` row with
`platform: "mcp"`, minted from the web UI instead of paired.

## How it works

**One request** (`web/src/app/api/mcp/route.ts` → `mcp`, exported as `GET` and `POST`):
1. `auth.ts` → `verifyMcpToken(request)`: `bearerToken` + `resolveDeviceToken` (the same lookup as
   `authenticateDevice`, see [devices-and-pairing](../devices-and-pairing/README.md)). Returns the SDK's
   `AuthInfo` with `scopes: device.scopes` and the device, workstation and user ids in `extra`.
2. A fresh handler is built per request with `createMcpHandler` (`mcp-handler`), because its
   server factory cannot see the request; the closure carries `authInfo`.
3. `withMcpAuth(..., { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource" })`
   turns a missing token into an RFC 9728 `401` challenge.
4. With a token, `registry.ts` → `registerTools(server, toContext(authInfo))` registers only
   `toolsFor(scopes)`: tools whose `scope` the token `satisfies`. A read-only token never sees a
   write tool in `tools/list`, so a model cannot try it and a prompt injection cannot name it.
5. Each handler is wrapped in one try/catch: a return value becomes `result.ts` → `ok` (pretty JSON
   text); a throw becomes `fail` (`isError: true` content the model can read and act on), not a
   JSON-RPC error.

**Context, not arguments.** `types.ts` → `McpContext` = `{ device, deviceId, workstationId, userId,
scopes }`. A token belongs to exactly one workstation, so no tool takes a `workstationId`;
cross-tenant access cannot be expressed.

**Scopes** (`scopes.ts`): `MCP_AREAS` = workstations, blueprints, code, automations, sessions,
approvals, devices, usage, vision. Each area has `<area>:read` and `<area>:write` (`ALL_SCOPES`).
`satisfies(held, need)`: exact match, or `:write` implies `:read`; unknown strings never satisfy, so
removing an area revokes it without a migration. `defaultScopesForMode("write")` = every scope,
`("read")` = every `:read`; used when a paired device is approved without explicit scopes.

**Tenancy inside tools** (`web/src/server/mcp/tools/shared.ts`): `requireAutomation(ctx, id)` → `ownsAutomation`
scoped by workstation; `requireBlueprintAccess(ctx, id, need)` → `ownsBlueprint`, same workstation,
then `hasGrant`. Two gates for blueprints: the scope says "may write blueprints at all", the
`device_grant` says which ones. "Not yours" and "does not exist" give the same message so ids cannot
be probed.

**Minting a token** (`web/src/app/api/device/mcp-token/route.ts` → `POST`): session user must own the
workstation; named blueprints must be in it; then, in one transaction, insert a `device`
(`platform: "mcp"`, `tokenHash`, `tokenPrefix`, `scopes`, approved by the caller) and its
`device_grant` rows. Unlike pairing, the token is generated here and returned once, because an MCP
client cannot poll. Only its sha256 is stored. Listing, renaming, re-scoping, revoking and deleting
use the normal device routes; the UI is `web/src/components/account/mcp-tokens-manager.tsx`
(in [auth-and-accounts](../auth-and-accounts/README.md)).

**Adding an area**: write `tools/<area>.ts` exporting an `McpModule`, add it to `MODULES` in
`web/src/server/mcp/tools/index.ts`, add the name to `MCP_AREAS`. The registry, the `tools/list` filter and the
token UI's `ScopeMatrix` follow.

## Files
| File | Responsibility |
|---|---|
| `web/src/app/api/mcp/route.ts` | The MCP endpoint: verify once, build server per request, `withMcpAuth` |
| `web/src/app/api/device/mcp-token/route.ts` | `POST`: mint an MCP token (device row + grants) |
| `web/src/server/mcp/auth.ts` | `verifyMcpToken`, `toContext` |
| `web/src/server/mcp/scopes.ts` | `MCP_AREAS`, `McpArea`, `McpScope`, `ALL_SCOPES`, `isMcpScope`, `satisfies`, `defaultScopesForMode` (plain constants, safe to import in client code) |
| `web/src/server/mcp/types.ts` | `McpContext`, `McpTool`, `McpModule`, `tool` (keeps input and handler types inferred together) |
| `web/src/server/mcp/registry.ts` | `ALL_TOOLS`, `toolsFor`, `registerTools` |
| `web/src/server/mcp/result.ts` | `ToolResult`, `ok`, `fail`, `ToolError`, `toolError` |
| `web/src/server/mcp/tools/index.ts` | `MODULES`: the tool modules on offer |
| `web/src/server/mcp/tools/shared.ts` | `requireAutomation`, `requireBlueprintAccess` |
| `web/src/server/mcp/tools/workstations.ts` | `workstationsModule`: `whoami`, `device_list` |
| `web/src/server/mcp/tools/automations.ts` | `automationsModule`: list/get/versions/runs/run, status, triggers |
| `web/src/server/mcp/tools/authoring.ts` | `authoringModule`: node types, flat-graph get/validate/save, create, publish, delete |
| `web/src/server/mcp/tools/blueprints.ts` | `blueprintsModule`: list/get/view/versions/diff/check/symbol, edit, restore |

## Interfaces

**Routes**

| Method · path | Auth | Body | Response | Handler |
|---|---|---|---|---|
| `GET`/`POST /api/mcp` | device token (`Authorization: Bearer jvd_…`), scopes from `device.scopes` | MCP JSON-RPC, served by `mcp-handler` | MCP responses; 401 RFC 9728 challenge without a valid token | `web/src/app/api/mcp/route.ts` → `mcp` |
| `POST /api/device/mcp-token` | session, owns workstation | `{ workstationId, name (trimmed 1–64), scopes: McpScope[] (≤64, unknown rejected), blueprintIds=[], allBlueprints=false, mode="read" }` | `{ success, token, device: { id, name, scopes } }`; 400 `invalid_request` (with up to 5 zod issues) / `blueprint_not_in_workstation`; 403 | `web/src/app/api/device/mcp-token/route.ts` → `POST` |

**Tools** (name · scope · what it does)

| Tool | Scope | Notes |
|---|---|---|
| `whoami` | `workstations:read` | Bound workstation, token name, scopes. "Call this first" |
| `device_list` | `devices:read` | Devices in the workstation with `lastSeenAt` |
| `automation_list` | `automations:read` | All automations, status, published version |
| `automation_get` | `automations:read` | Latest saved editor graph and published compiled definition |
| `automation_versions` | `automations:read` | Saved versions, newest first |
| `automation_runs` | `automations:read` | Recent runs (`limit` 1–100, default 20) |
| `automation_run_get` | `automations:read` | One run with steps; `suspended`/`waitingOn` when an agent step is pending |
| `automation_run` | `automations:write` | Start the published version; returns a runId, does not wait |
| `automation_set_status` | `automations:write` | `active`/`paused`/`archived`; activating needs a published version |
| `automation_triggers` | `automations:read` | Webhook and cron triggers |
| `automation_trigger_create` | `automations:write` | Via `createTrigger`; cron only fires while a workstation polls |
| `automation_trigger_delete` | `automations:write` | Removing a webhook revokes its URL |
| `automation_node_types` | `automations:read` | Node types with JSON Schema for params |
| `automation_get_graph` | `automations:read` | Latest graph in the flat `{ nodes, connections }` form |
| `automation_validate` | `automations:read` | Compile without saving; errors and execution order |
| `automation_create` | `automations:write` | Empty draft (`atm_…`) |
| `automation_save_graph` | `automations:write` | Validate, then save a new draft version; refuses invalid graphs |
| `automation_publish` | `automations:write` | Compile latest and set active |
| `automation_delete` | `automations:write` | Drafts only; published ones must be archived instead |
| `blueprint_list` | `blueprints:read` | Filtered by `readableBlueprintIds` |
| `blueprint_get` | `blueprints:read` | Full `BlueprintDoc` at current or `at` (`v3` or commit sha) |
| `blueprint_view` | `blueprints:read` | Braille text (default) or SVG render |
| `blueprint_versions` | `blueprints:read` | History, newest first |
| `blueprint_diff` | `blueprints:read` | Entity-level diff between two refs |
| `blueprint_check` | `blueprints:read` | Engineering rule checks by domain |
| `blueprint_symbol` | `blueprints:read` | Search the symbol library (no blueprint access check) |
| `blueprint_edit` | `blueprints:write` | `applyOps`, all-or-nothing, appended as a new version |
| `blueprint_restore` | `blueprints:write` | Append a copy of an old version |

## Data and state
| Table | Use |
|---|---|
| `device` | Token lookup; `scopes text[]` is the MCP permission set; `platform = "mcp"` marks minted tokens |
| `device_grant` | Blueprint-level reach, checked by `requireBlueprintAccess` / `readableBlueprintIds` |
| `workstation` | `whoami`, ownership |
| `automation`, `automation_version`, `automation_run`, `automation_run_step`, `automation_trigger` | Automation tools |
| `blueprint`, `blueprint_version` | Blueprint tools (writes go through `appendBlueprintVersion`) |

No env vars of its own. No caches: tools are registered per request.

## Depends on / used by
- Depends on: [devices-and-pairing](../devices-and-pairing/README.md) (`resolveDeviceToken`,
  `bearerToken`, `hasGrant`, `readableBlueprintIds`, `ownership.ts`),
  [automations](../automations/README.md) (`startRun`, `publishedVersionOf`, `createTrigger`,
  `triggerInputSchema`, `publishAutomation`, `saveAutomationGraph`, `editorGraphToDefinition`,
  `nodeRegistry`), [blueprints](../blueprints/README.md) (`appendBlueprintVersion`) and the shared TUI
  engine under `tui/src/blueprint/` (`applyOps`, `checkDoc`, `diffDocs`, `renderBraille`, `toSvg`,
  `searchSymbols`, `BlueprintDocSchema`), `mcp-handler`, `@modelcontextprotocol/server`.
- Used by: MCP clients; `scopes.ts` is imported by the device approve/scopes routes and by
  `web/src/components/devices/scope-matrix.tsx`.

## Gotchas
- **Scopes exist for areas with no tools.** `MODULES` covers workstations, automations (two modules)
  and blueprints. `code`, `sessions`, `approvals`, `usage` and `vision` scopes can be granted but no
  tool requires them yet; `devices:read` is used only by `device_list`.
- **No `/.well-known/oauth-protected-resource` route exists.** The 401 challenge points at it, but
  there is no file for it under `web/src/app/`, so clients that follow it get a 404. Clients must be
  given the bearer token directly.
- Blueprint tools only speak the versioned `BlueprintDoc` format. A row in the older web-editor
  format fails with a message saying so (`LEGACY_HINT`), not as corrupt.
- `automation_get_graph` sorts versions descending on purpose: `automation_create` writes an empty
  version 1.
- `automation_run` refuses a published version with no compiled `definition`, which the runner would
  otherwise run as an empty graph and report as success.
- Minted tokens default to `mode: "read"` grants; paired devices default to `"write"`.
- `scopes.ts` must stay free of DB and `node:` imports; the client bundle imports it.

## Tests
- `web/src/__tests__/mcp-scopes.test.ts`: `ALL_SCOPES`, `isMcpScope`, `MCP_AREAS`, `satisfies`.
- `web/src/__tests__/mcp-registry.test.ts`: `toolsFor` filtering, unique names, every tool has a real
  scope and a description.
- `web/src/__tests__/mcp-authoring.test.ts`: `editorGraphToDefinition`, `topoSort` (what
  `automation_save_graph` relies on).
- `web/src/__tests__/device-approve-scopes.test.ts`: `defaultScopesForMode`.

Run: `pnpm --filter web test`. The route and tool handlers are not tested against a database.
