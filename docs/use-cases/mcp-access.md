# MCP access

Modules: [web/mcp](../modules/web/mcp/README.md), [web/auth-and-accounts](../modules/web/auth-and-accounts/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why
A user who wants an MCP client (Claude Code, Cursor, or the JARVIS TUI through a `remote` entry
under `mcp` in its config) to read and change one workstation's blueprints and automations. The JARVIS cloud
serves MCP at `/api/mcp`. The credential is the same `jvd_` device token a paired machine uses,
and what it may do is its list of scopes. A user mints a token in the web app. A paired device
already has one.

## Flow
**Mint a token (web).**
1. The user opens the account dialog → MCP tab, or the MCP tokens card on `/app/settings`. Both
   render `web/src/components/account/mcp-tokens-manager.tsx` → `McpTokensManager`. It lists the
   `device` rows with `platform: "mcp"` in the chosen workstation (the active one by default).
2. "Create" asks for a name, one none/read/write level per scope area, and which blueprints
   (all, or a chosen set). Defaults: `workstations:read`, `automations:read`, `blueprints:read`, all blueprints.
3. The browser posts `POST /api/device/mcp-token` (`web/src/app/api/device/mcp-token/route.ts`).
   The server checks the session, that the user owns the workstation, and that every named blueprint
   is in it. Then, in one transaction, it inserts a `device` row (`platform: "mcp"`, the token's sha256
   and prefix, the scopes) and its `device_grant` rows.
4. The response carries the token. The UI shows it **once**, with a ready command to copy:
   `claude mcp add --transport http jarvis <origin>/api/mcp --header "Authorization: Bearer jvd_…"`.

**Use a paired device's token.** A device paired with `jarvis pair` ([pair-a-device.md](pair-a-device.md))
holds a `jvd_` token in its credentials file. Approval gave it every scope (write mode) or every `:read` scope
(read mode). It can call `/api/mcp` with that token. Nothing in the TUI wires this up automatically.

**One MCP request** (`web/src/app/api/mcp/route.ts` → `mcp`, for `GET` and `POST`).
1. `web/src/server/mcp/auth.ts` → `verifyMcpToken` reads `Authorization: Bearer jvd_…` and resolves
   it with `resolveDeviceToken`, the same check every device route uses: lookup by hash,
   `status: "active"`, not deactivated.
2. No valid token: `withMcpAuth` (required) answers 401 with a bearer challenge.
3. With a token, a fresh MCP server is built for this request. `web/src/server/mcp/registry.ts` →
   `registerTools` registers only `toolsFor(scopes)`, the tools whose scope the token satisfies.
   `tools/list` shows only those, and calling any other tool fails as an unknown tool.
4. The tool runs with a context of device, workstation and user taken from the token. No tool takes a workstation id.
5. A returned value becomes JSON text. A thrown error becomes an `isError: true` result the model can read,
   not a protocol error.

**Manage tokens.** The list shows each token's scopes and status. The menu renames, edits access ("Manage access":
scopes and blueprint grants together), copies the id, revokes, and, once revoked, deletes. "Show revoked"
keeps dead tokens visible so the user can confirm a leaked one is really off.

## Business rules
- **Scope vocabulary** (`web/src/server/mcp/scopes.ts`): areas `workstations`, `blueprints`, `code`,
  `automations`, `sessions`, `approvals`, `devices`, `usage`, `vision`, each with `:read` and `:write`.
- **`satisfies(held, need)`:** an exact match, or `<area>:write` covers `<area>:read`. Unknown strings
  never satisfy anything, so removing an area revokes it without a migration.
- **What each scope unlocks over MCP** (28 tools in `web/src/server/mcp/tools/`):

  | Scope | Tools |
  |---|---|
  | `workstations:read` | `whoami` (bound workstation, token name, scopes) |
  | `devices:read` | `device_list` (devices in the workstation, last seen) |
  | `automations:read` | list, get, versions, runs, run_get, triggers, node_types, get_graph, validate |
  | `automations:write` | `automation_run`, `automation_set_status`, trigger create/delete, `automation_create`, `automation_save_graph`, `automation_publish`, `automation_delete` |
  | `blueprints:read` | list, get, view, versions, diff, check, symbol |
  | `blueprints:write` | `blueprint_edit`, `blueprint_restore` |
  | `code`, `sessions`, `approvals`, `usage`, `vision` | No MCP tool. `code` and `vision` are checked by REST routes, see [pair-a-device.md](pair-a-device.md) |

- **Blueprints have two gates.** The scope says "may read or write blueprints at all". The token's
  `device_grant` rows say which ones (`web/src/server/mcp/tools/shared.ts` → `requireBlueprintAccess`).
  `blueprint_list` is filtered by `readableBlueprintIds`. `blueprint_symbol` searches the symbol library and needs no grant.
- **Tenancy:** a token belongs to one workstation. "Not yours" and "does not exist" give the same
  message ("No automation … on this workstation."), so ids cannot be probed.
- **Mint request limits:** name trimmed, 1–64 characters. Up to 64 scopes, and any unknown scope fails the whole
  request with 400 `invalid_request` (with up to 5 validation issues). Grant `mode` defaults to `read`.
  The UI sets it to `write` only when the blueprints level is write.
- **The API accepts zero scopes.** Such a token sees no tools. The UI blocks creating one.
- **The token exists in readable form only in the mint response.** The server keeps its sha256 and a 10-character prefix.
- **Checked on every request.** There is no session and no cache: each HTTP request resolves the token again.
  A revoke or a scope change applies from the next request.
- **Revoke, then delete:** revoking sets `status: "revoked"` and clears the hash. Delete is refused
  with 409 `not_revoked` until then (`canDeleteDevice`).
- **Rate limit:** `/api/mcp` falls under nginx's general `/api/` limit, 10 requests a second per IP with a burst of 50
  (`k8s/base/nginx.conf`).

## When it fails
- **401 with a `WWW-Authenticate` challenge:** no token, a mistyped one, or a revoked one. The challenge
  points at `/.well-known/oauth-protected-resource`, but no such route exists, so OAuth discovery
  gets a 404. Clients must be given the bearer header directly. Mint a new token if it was lost.
- **A tool the user expects is missing from `tools/list`:** the token lacks that scope. Raise it under "Manage access", then reconnect
  or list again.
- **"This token has no write grant for blueprint …":** the scope is there but the blueprint grant is not, or is read-only.
  Add it under "Manage access".
- **"No automation … / No blueprint … on this workstation.":** wrong id, or it belongs to another workstation.
  Call `whoami` to see which workstation the token is bound to.
- **403 on minting:** the user does not own that workstation. **400 `blueprint_not_in_workstation`:** a picked
  blueprint is in another workstation.
- **Token lost after closing the dialog:** it cannot be shown again. Revoke it and mint a new one.

## Related
- [pair-a-device.md](pair-a-device.md): device tokens, grants and the non-MCP scopes.
- [sign-up-and-sign-in.md](sign-up-and-sign-in.md): the session needed to mint and manage tokens.
- [blueprints.md](blueprints.md), [automations.md](automations.md): what the tools act on.
- Module docs: [web/mcp](../modules/web/mcp/README.md), [web/auth-and-accounts](../modules/web/auth-and-accounts/README.md),
  [web/devices-and-pairing](../modules/web/devices-and-pairing/README.md).
