# Devices and pairing

Code: `web/src/app/api/device/` (except `automation/`, `hand/`, `mcp-token/`, `prompt/`), `web/src/app/api/workstation/` (except `automation/`, `blueprint/`), `web/src/server/{device-auth,owned-device,ownership}.ts`, `web/src/components/{devices,workstation}/`, `web/src/app/(protected)/link/`, `web/src/lib/validation/workstations.ts`, `web/src/lib/workstation-hooks.ts` · Verified: 2026-10-14 @ c9135de

## Purpose
How a machine (a laptop running the TUI, a Pi, an MCP client) gets a `jvd_` bearer token for one
workstation, and how the owner controls what that token may reach. Pairing is the RFC 8628 device
authorization grant: the device asks, a signed-in human approves after checking a fingerprint, and
the device collects its token on its next poll. Also owns workstations themselves (create, list,
the "active workstation" cookie) and the tenancy rules every other module checks against.
Usage (`jarvis pair`, `/pair`) is in [tui/README.md](../../../../tui/README.md).

## How it works

**Pairing, end to end.**
1. The device starts. `tui/src/cli/pair-flow.ts` → `requestCode` posts `{ name, fingerprint, platform, email? }`
   to `POST /api/device/code`. `fingerprint()` is sha256 of `/etc/machine-id` (or the hostname) plus
   the hostname, first 12 hex chars. Two front ends drive it: `jarvis pair` (`tui/src/cli/pair.ts` →
   `pair`, headless, for SSH) and the `/pair` wizard (`tui/src/ui/pair-setup.ts`).
2. The server (`web/src/app/api/device/code/route.ts` → `POST`) sweeps expired `device_link` rows,
   resolves `email` case-insensitively to a `user.id` (unknown email → `targetUserId: null`, same
   response, so the endpoint is not an account oracle), and inserts a `device_link` row holding only
   `sha256(deviceCode)`. It returns `userCode` (`device-auth.ts` → `newUserCode`, `XXXX-XXXX`,
   Crockford base32 without I/L/O/U, rejection-sampled), `deviceCode`, `verificationUri`
   (`<NEXT_PUBLIC_BASE_URL>/link`), `verificationUriComplete` (`/link?code=…`), a terminal QR,
   `expiresIn` (600 s, `CODE_TTL_MS`) and `interval` (5 s, `POLL_INTERVAL_SECONDS`).
3. The device prints the QR and code and loops in `pair-flow.ts` → `pollForToken`, calling
   `POST /api/device/token` every `interval`. `authorization_pending` → keep going; `slow_down` →
   add 5 s; anything else is terminal.
4. The human approves by one of three doors, all rendering the same form
   (`web/src/components/devices/device-approval.tsx` → `DeviceApproval`, so defaults cannot drift):
   - scanning the QR → `/link?code=…` (`web/src/app/(protected)/link/page.tsx` → `LinkApproval`);
   - the pending list, if the device named the user's email (`pending-requests-card.tsx` →
     `PendingRequestsCard`, `GET /api/device/pending`);
   - typing the code into `link-device-dialog.tsx` → `LinkDeviceDialog`.
   Each first calls `GET /api/device/approve?code=` to show name, platform and fingerprint, then
   `POST /api/device/approve` with the workstation, blueprint grants, mode and (optionally) MCP scopes.
5. Approval (`web/src/app/api/device/approve/route.ts` → `POST`) checks the workstation is the
   caller's, `mayActOnLink`, and that every named blueprint lives in that workstation. It inserts a
   `device` row **with no token**, `device_grant` rows, and sets `device_link.approvedDeviceId`.
   MCP scopes default to `defaultScopesForMode(mode)` (see [web/mcp](../mcp/README.md)).
6. The next poll (`web/src/app/api/device/token/route.ts` → `POST`) mints the token
   (`newToken`, `jvd_` + 32 random bytes), stores `sha256(token)` and a short `tokenPrefix`, deletes
   the link, and returns `{ deviceId, token, workstationId, name }`. If the device already has a
   token hash (replayed device code) or is not active, it deletes the link and answers
   `access_denied`. The TUI writes this to `<dataDir>/credentials.json` (mode 600).
7. The dialog's third view and `DevicesCard` poll `GET /api/device/list` until the new row reports
   `paired: true` (token minted).

**Using the token.** `device-auth.ts` → `authenticateDevice(request)` reads
`Authorization: Bearer jvd_…` (`bearerToken`) and calls `resolveDeviceToken`: lookup by hash,
`status === "active"`, `isActive !== false`, `timingSafeEqual`, and a fire-and-forget
`lastSeenAt` bump. The MCP server reuses `resolveDeviceToken`, so there is one validation path.

**Access model, two independent boundaries.**
- *Grants* (`device_grant`): which blueprints the REST sync routes let a device touch.
  `blueprintId: null` = every blueprint in the workstation, including future ones.
  `device-auth.ts` → `hasGrant(deviceId, blueprintId, need)` (write needs a `write` grant, read
  needs any), `readableBlueprintIds` / pure `grantsToReadable` for list filtering in one query.
- *Scopes* (`device.scopes`): what the token may do over MCP. Only the MCP server reads them.
  `device-access-form.tsx` → `DeviceAccessForm` saves both at once (`PATCH …/grants` and
  `PATCH …/scopes`), with `scope-matrix.tsx` → `ScopeMatrix` rendering one none/read/write row per
  `MCP_AREAS` entry.

**Ownership.** `web/src/server/ownership.ts` holds the tenancy rules with no `Request` and no
better-auth import, so cookie routes and MCP tools share them: `ownsWorkstation`,
`ownsAutomation` (scoped by workstation *and* id), `ownsBlueprint`. `web/src/server/owned-device.ts`
→ `ownedDevice(request, deviceId)` is the HTTP shell every `/api/device/[deviceId]/…` route uses:
401 without a session, 404 for no device, 403 if the user does not own its workstation.

**Revoke, then delete.** `POST …/revoke` sets `status: "revoked"`, `isActive: false`,
`tokenHash: null`; the next request with that token fails. `DELETE /api/device/[deviceId]` only
works on a revoked device (`canDeleteDevice`), so one click never both kills a token and erases
the record. `jarvis unpair` only deletes the local credentials file and says the token is still live.

**Workstations.** The active workstation is an httpOnly cookie `active_workstation_id`
(`web/src/app/api/workstation/active/route.ts`). `web/src/lib/workstation-hooks.ts` →
`useActiveWorkstation` reads it and resolves it against `GET /api/workstation/list`, so an id the
user does not own resolves to nothing.

## Files
| File | Responsibility |
|---|---|
| `web/src/server/device-auth.ts` | Token and code primitives (`newUserCode`, `newDeviceCode`, `newToken`, `sha256`, `normaliseUserCode`, `CODE_TTL_MS`, `POLL_INTERVAL_SECONDS`, `TOKEN_PREFIX`), `bearerToken`, `resolveDeviceToken`, `authenticateDevice`, `hasGrant`, `grantsToReadable`, `readableBlueprintIds`, `canDeleteDevice`, `mayActOnLink`, `forbidden` |
| `web/src/server/owned-device.ts` | `ownedDevice`: session + device exists + owns its workstation, as a route guard |
| `web/src/server/ownership.ts` | `ownsWorkstation`, `ownsAutomation`, `ownsBlueprint`, `OwnershipFailure` |
| `web/src/app/api/device/code/route.ts` | Pairing step 1: create `device_link`, return codes and QR |
| `web/src/app/api/device/token/route.ts` | Pairing step 2: poll, mint token on first poll after approval |
| `web/src/app/api/device/approve/route.ts` | `GET` look up a code for the approval screen; `POST` approve into a workstation |
| `web/src/app/api/device/reject/route.ts` | Delete a pending request addressed to the caller |
| `web/src/app/api/device/pending/route.ts` | Requests addressed to the caller, with `knownFingerprint` |
| `web/src/app/api/device/list/route.ts` | Devices of one workstation with access summary and scopes |
| `web/src/app/api/device/[deviceId]/route.ts` | `PATCH` rename, `DELETE` purge a revoked device |
| `web/src/app/api/device/[deviceId]/grants/route.ts` | `GET`/`PATCH` (replace) blueprint grants |
| `web/src/app/api/device/[deviceId]/scopes/route.ts` | `GET`/`PATCH` (replace) MCP scopes |
| `web/src/app/api/device/[deviceId]/revoke/route.ts` | Revoke: clear token hash, mark revoked |
| `web/src/app/api/workstation/create/route.ts` | Create a workstation for the caller |
| `web/src/app/api/workstation/list/route.ts` | The caller's workstations |
| `web/src/app/api/workstation/active/route.ts` | Get/set the `active_workstation_id` cookie |
| `web/src/app/api/workstation/device/usage/route.ts` | `sync_log` request counts per device and action |
| `web/src/app/(protected)/link/page.tsx` | QR landing: renders `LinkApproval`, or redirects to `/app/settings` with no code |
| `web/src/app/(protected)/link/link-approval.tsx` | `LinkApproval`: phone-sized approval card for one code |
| `web/src/components/devices/device-approval.tsx` | `DeviceApproval`: fingerprint panel, blueprint scope, mode, Approve |
| `web/src/components/devices/link-device-dialog.tsx` | `LinkDeviceDialog`: code → review → waiting-for-token views |
| `web/src/components/devices/pending-requests-card.tsx` | `PendingRequestsCard`: addressed requests with countdown, approve/reject |
| `web/src/components/devices/devices-card.tsx` | `DevicesCard`: device table, liveness, revoke, opens access sheet |
| `web/src/components/devices/device-access-form.tsx` | `DeviceAccessForm`: edit grants and scopes together |
| `web/src/components/devices/device-access-sheet.tsx` | `openDeviceAccessSheet`: floats the form in the global sheet |
| `web/src/components/devices/scope-matrix.tsx` | `ScopeMatrix`, `levelOf`, `toScopes`, `levelsFrom` |
| `web/src/components/devices/add-device-panel.tsx` | `AddDevicePanel`: `curl … /install.sh \| sh` built from `window.location.origin` |
| `web/src/components/devices/mcp-tokens-dialog.tsx` | `McpTokensDialog`: settings-page door to `McpTokensManager` |
| `web/src/components/workstation/create-workstation-dialog.tsx` | `CreateWorkstationDialog`: form, logo to base64, `useCreateWorkstation` |
| `web/src/components/workstation/workstation-select-dropdown-menu.tsx` | `WorkstationSelectDropdownMenu`: switch active workstation |
| `web/src/components/workstation/workstation-info.tsx` | `WorkstationInfo`, `WorkstationInfoSkeleton` |
| `web/src/components/workstation/no-workstation-selected.tsx` | `NoWorkstationSelected` / `WorkstationSelected` render gates |
| `web/src/lib/validation/workstations.ts` | `workstationCreateSchema` (client form), `generateRandomSlug` |
| `web/src/lib/workstation-hooks.ts` | `useListWorkstations`, `useActiveWorkstation`, `useSetActiveWorkstation`, `useCreateWorkstation`, `useWorkstationAuthStatus` |

## Interfaces

Device token = `Authorization: Bearer jvd_…`. Session = better-auth cookie (or bearer session token).

| Method · path | Auth | Body / query | Response | Handler |
|---|---|---|---|---|
| `POST /api/device/code` | none | `{ name (1–64), fingerprint (4–128), platform?, email? }` | `{ userCode, deviceCode, verificationUri, verificationUriComplete, qr, expiresIn, interval }` | `web/src/app/api/device/code/route.ts` → `POST` |
| `POST /api/device/token` | none (device code) | `{ deviceCode }` | 200 `{ deviceId, token, workstationId, name }`; 400 `authorization_pending` / `expired_token` / `access_denied` / `invalid_request`; 429 `slow_down` | `web/src/app/api/device/token/route.ts` → `POST` |
| `GET /api/device/approve?code=` | session | — | `{ request: { name, fingerprint, platform, expiresAt } }`; 404 `expired_or_unknown`; 409 `already_approved` | `web/src/app/api/device/approve/route.ts` → `GET` |
| `POST /api/device/approve` | session, owns workstation | `{ userCode, workstationId, name?, blueprintIds=[], allBlueprints=false, mode="write", scopes? }` | `{ success, device: { id, name, grants } }`; 400 `blueprint_not_in_workstation`; 403; 404; 409 | `web/src/app/api/device/approve/route.ts` → `POST` |
| `POST /api/device/reject` | session | `{ userCode }` | `{ success: true }` always (only deletes rows addressed to caller) | `web/src/app/api/device/reject/route.ts` → `POST` |
| `GET /api/device/pending` | session | — | `{ success, requests: [{ userCode, name, fingerprint, platform, knownFingerprint, createdAt, expiresAt }] }` | `web/src/app/api/device/pending/route.ts` → `GET` |
| `GET /api/device/list?workstationId=` | session, owns workstation | — | `{ success, devices: [{ id, name, platform, fingerprint, tokenPrefix, status, paired, lastSeenAt, approvedAt, createdAt, scopes, access }] }` | `web/src/app/api/device/list/route.ts` → `GET` |
| `PATCH /api/device/[deviceId]` | session, `ownedDevice` | `{ name (trimmed 1–64) }` | `{ success, name }` | `web/src/app/api/device/[deviceId]/route.ts` → `PATCH` |
| `DELETE /api/device/[deviceId]` | session, `ownedDevice` | — | `{ success }`; 409 `not_revoked` | `web/src/app/api/device/[deviceId]/route.ts` → `DELETE` |
| `GET /api/device/[deviceId]/grants` | session, `ownedDevice` | — | `{ success, allBlueprints, mode, blueprintIds }` | `web/src/app/api/device/[deviceId]/grants/route.ts` → `GET` |
| `PATCH /api/device/[deviceId]/grants` | session, `ownedDevice` | `{ blueprintIds=[], allBlueprints=false, mode="write" }` | `{ success, grants }` (replaces all, in a transaction) | `web/src/app/api/device/[deviceId]/grants/route.ts` → `PATCH` |
| `GET /api/device/[deviceId]/scopes` | session, `ownedDevice` | — | `{ success, scopes }` | `web/src/app/api/device/[deviceId]/scopes/route.ts` → `GET` |
| `PATCH /api/device/[deviceId]/scopes` | session, `ownedDevice` | `{ scopes: McpScope[] (≤64, all `isMcpScope`) }` | `{ success, scopes }` (replaces, de-duplicated) | `web/src/app/api/device/[deviceId]/scopes/route.ts` → `PATCH` |
| `POST /api/device/[deviceId]/revoke` | session, `ownedDevice` | — | `{ success }` | `web/src/app/api/device/[deviceId]/revoke/route.ts` → `POST` |
| `POST /api/workstation/create` | session | `{ id, name, logo? }` | the inserted row | `web/src/app/api/workstation/create/route.ts` → `POST` |
| `GET /api/workstation/list` | session | — | the caller's workstation rows | `web/src/app/api/workstation/list/route.ts` → `GET` |
| `GET /api/workstation/active` | none (cookie) | — | `{ id }` or `null` | `web/src/app/api/workstation/active/route.ts` → `GET` |
| `POST /api/workstation/active` | none | `{ workstationId }` | `{ success }`, sets cookie for 1 year | `web/src/app/api/workstation/active/route.ts` → `POST` |
| `GET /api/workstation/device/usage` | session | `?workstationId&days=30` | `{ windowDays, since, totalRequests, requests: [{ deviceId, deviceName, workstationId, workstationName, totalRequests, byAction }] }` | `web/src/app/api/workstation/device/usage/route.ts` → `GET` |

The browser client for these routes is `devicesApi` in `web/src/lib/api/blueprint-versions.ts`
(owned by [web/blueprints](../blueprints/README.md)). Minting an MCP token
(`POST /api/device/mcp-token`) also creates a `device` row; it is documented in [web/mcp](../mcp/README.md).

TUI commands (in [tui/cli](../../tui/cli/README.md)): `jarvis pair [email] [url]`, `jarvis unpair [-y]`,
`jarvis device`, and `/pair` inside the TUI.

## Data and state
| Table | Use |
|---|---|
| `device` (`web/src/server/db/schemas/device.ts`) | One paired machine or MCP token. `device_token` column holds the sha256 (`tokenHash`), `token_prefix`, `fingerprint`, `platform` (`"mcp"` for MCP tokens), `status` `active`/`revoked`, `scopes text[]`, `last_seen_at`; index `device_workstation_idx` |
| `device_link` (`web/src/server/db/schemas/device_link.ts`) | In-flight pairing request: `user_code` PK, `device_code_hash`, `expires_at`, `last_polled_at`, `approved_device_id`, `target_user_id` |
| `device_grant` (`web/src/server/db/schemas/device_grant.ts`) | `device_id`, `blueprint_id` (NULL = all), `mode` `read`/`write`. Two partial unique indexes so a device cannot hold two "all" grants |
| `workstation` (`web/src/server/db/schemas/workstation.ts`) | `user_id` is the owner, the root of every ownership check |
| `user` | Read by `device/code` to address a request by email |
| `blueprint` | Read to check named blueprints belong to the workstation |
| `sync_log` | Read by `workstation/device/usage` |

Env: `NEXT_PUBLIC_BASE_URL` (builds `verificationUri`). Cookie: `active_workstation_id`.
Device side: `<dataDir>/credentials.json` (`tui/src/blueprint/credentials.ts` → `credentialsPath`).
No in-memory caches.

## Depends on / used by
- Depends on: [auth-and-accounts](../auth-and-accounts/README.md) (`auth.api.getSession`),
  `web/src/server/mcp/scopes.ts` (`defaultScopesForMode`, `isMcpScope`, `MCP_AREAS`), `qrcode`.
- Used by: every device-token route (`authenticateDevice`): [sessions-and-approvals](../sessions-and-approvals/README.md),
  [gateway](../gateway/README.md), [blueprints](../blueprints/README.md), [automations](../automations/README.md),
  [code-projects](../code-projects/README.md), [vision](../vision/README.md); [mcp](../mcp/README.md)
  (`resolveDeviceToken`, `hasGrant`, `readableBlueprintIds`, `ownership.ts`).
- Client side: `tui/src/cli/pair-flow.ts`, `tui/src/cli/pair.ts`, `tui/src/ui/pair-setup.ts`.

## Gotchas
- **No readable token is ever stored.** Approval creates the device without a token; the token
  exists only in the one `/api/device/token` response. A second poll with the same device code
  gets `access_denied`, not a second token.
- **Addressed requests are private.** If `targetUserId` is set, only that user can look up,
  approve or reject it; others get the same 404 as an unknown code. `reject` always answers
  success so it cannot confirm someone else's request exists.
- **The pending list is a phishing surface.** `/api/device/code` is unauthenticated, so anyone who
  knows your email can put a row there; the name is attacker-chosen. The fingerprint and the
  `knownFingerprint` / "new device" badge are the defence.
- **Rate limiting is nginx, not code.** `device-auth.ts` mentions a "10-per-hour attempt cap", but no
  route enforces one. `k8s/base/nginx.conf` limits `/api/auth/`, `/api/device/code` and
  `/api/device/token` to 30 r/min per IP (burst 15) and answers 429 as `{"error":"slow_down"}`;
  `/api/device/approve` only gets the general `/api/` limit. `token` also returns `slow_down`
  itself if polled faster than 80% of the interval.
- **Grants vs scopes.** REST sync routes check only grants; MCP checks both. `blueprints:write`
  without a matching grant still cannot write a given blueprint.
- **`/api/workstation/active` has no auth and no ownership check.** It only sets the caller's own
  cookie, and `useActiveWorkstation` resolves the id against the owned list, so a foreign id
  resolves to `null`. Do not read that cookie server-side as if it were authorised.
- **`/api/workstation/create` trusts its body.** `workstationCreateSchema` runs only in the client
  form; the route casts the JSON. The `id` is client-chosen (`generateRandomSlug`), so a collision
  is a primary-key error (500).
- The `Workstation` type in `workstation-hooks.ts` has a `slug` field the table does not have.
- `device_grant` and `device.scopes` are both replaced, never merged, so unticking a box removes access.
- `DevicesCard` "polling now" means `lastSeenAt` under 60 s ago, which works because
  `resolveDeviceToken` bumps it on every authenticated request.
- Index note: `docs/modules/README.md` lists `web/src/app/api/device/code/` under Code projects, but
  `web/src/app/api/device/code/route.ts` is pairing step 1 and is documented here.

## Tests
- `web/src/__tests__/device-pending.test.ts`: `mayActOnLink`, `normaliseUserCode`.
- `web/src/__tests__/device-grants.test.ts`: `grantsToReadable`.
- `web/src/__tests__/device-delete.test.ts`: `canDeleteDevice`.
- `web/src/__tests__/device-approve-scopes.test.ts`: `defaultScopesForMode` (the approval default).
- TUI side: `tui/test/pair-flow.test.ts`, `tui/test/pair.test.ts`, `tui/test/pair-setup.test.ts`.

Run: `pnpm --filter web test` (jest, `web/jest.config.cjs`); TUI: `cd tui && bun test test/pair`.
No route handler is tested end to end; the pure rules are pulled out so they can be.
