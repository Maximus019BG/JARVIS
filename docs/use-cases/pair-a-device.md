# Pair a device

Modules: [web/devices-and-pairing](../modules/web/devices-and-pairing/README.md), [tui/cli](../modules/tui/cli/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why
A user who wants a machine (a laptop running the TUI, a Pi over SSH, a worker box) to talk to
their JARVIS cloud. The machine runs `jarvis pair`, the user approves it in the web app, and the
machine gets a `jvd_` device token bound to one workstation. The flow is the RFC 8628 device
authorization grant. Nothing is granted until a signed-in human approves.

## Flow
1. **The user has a workstation.** A device always pairs *into* a workstation. With none, `/app/settings` only
   offers "Create a workstation". Approval goes into the user's **active** workstation (the
   `active_workstation_id` cookie, switched in the workstation menu).
2. **The device asks.** `jarvis pair [email] [url]` (`tui/src/cli/pair.ts` → `pair`), or `/pair`
   inside the TUI (`tui/src/ui/pair-setup.ts`), calls `tui/src/cli/pair-flow.ts` → `requestCode`.
   It posts `POST /api/device/code` with a name (default: the hostname), a fingerprint, a platform
   label (`<os>-<arch> · <hostname>`) and, optionally, the user's email.
   - Server base URL, first match wins: the argument, `JARVIS_CLOUD_URL`, `cloud` in the config,
     then a prompt (default `http://localhost:3000`).
   - Fingerprint: the first 12 hex chars of sha256 of `<machine-id>:<hostname>`. The machine id
     comes from `/etc/machine-id`, then `/var/lib/dbus/machine-id`, else the hostname.
3. **The server records the request** (`web/src/app/api/device/code/route.ts` → `POST`). It deletes
   expired requests, looks up the email (case-insensitive) and stores a `device_link` row holding
   only the sha256 of the device code. It returns a user code like `WXYZ-3QF7`, the device code,
   `<NEXT_PUBLIC_BASE_URL>/link?code=…`, a terminal QR of that URL, `expiresIn` and `interval`.
4. **The device waits.** It prints the QR and the code, then polls `POST /api/device/token` every
   `interval` seconds (`pollForToken`).
5. **The user approves**, after checking that the fingerprint matches the machine. There are three ways in, all
   rendering `web/src/components/devices/device-approval.tsx` → `DeviceApproval`:
   - scan the QR, which opens `/link?code=…` (sign-in first if needed, then back to the code);
   - "Waiting to be approved" on `/app/settings`, if the device named this user's email. It
     refreshes every 5 s and marks a fingerprint not seen in the user's workstations as new;
   - type the code into the "Link a device" dialog on `/app/settings`.
   The form asks which blueprints (all, or a chosen set) and read or write. Defaults: all, write.
6. **Approval** (`web/src/app/api/device/approve/route.ts` → `POST`) checks that the user owns the workstation, may
   act on this request, and that every named blueprint is in that workstation. It inserts a `device` row
   **with no token**, its `device_grant` rows, and MCP scopes from `defaultScopesForMode(mode)`.
7. **The next poll mints the token** (`web/src/app/api/device/token/route.ts`): `jvd_` + 32 random
   bytes. Only its sha256 and a 10-character prefix are stored. The request row is deleted and the token is returned once.
8. **The device saves it** to `credentials.json` under the data dir (`~/.local/share/jarvis/` by
   default), mode 600 (`tui/src/blueprint/credentials.ts`). The web dialog sees `paired: true` in
   `GET /api/device/list` and shows the device as connected.
9. **Every later call** sends `Authorization: Bearer jvd_…`. `web/src/server/device-auth.ts` →
   `resolveDeviceToken` checks it against the hash, `status: "active"` and `isActive`.

**Manage devices** (`/app/settings` → Devices). The table shows each device with its platform, token
prefix, access ("All blueprints · write", "2 blueprints · read", "No access") and liveness ("polling
now" if seen in the last 60 s). The menu edits access (grants and scopes together) or revokes the device.
`jarvis device` prints the local pairing. `jarvis unpair -y` deletes only the local file.

## Business rules
- **Code lifetime:** 10 minutes (`CODE_TTL_MS`). **Poll interval:** 5 s (`POLL_INTERVAL_SECONDS`).
  A poll sooner than 4 s after the last one (80% of the interval) gets 429 `slow_down`. The TUI then adds 5 s.
- **User code:** 8 characters from Crockford base32 without I, L, O and U, shown as `XXXX-XXXX`.
  Typed input is uppercased, stripped of anything but letters and digits, and re-hyphenated (`normaliseUserCode`).
- **Addressed requests are private.** If the email matched an account, only that user can look up,
  approve or reject the code. Everyone else gets the same 404 as an unknown code. An unknown email
  gets exactly the same response as a known one, so the endpoint does not reveal who has an account.
  A request with no email can be approved by anyone signed in who has the code (`mayActOnLink`).
- **One token per approval.** A second poll after the token was issued gets `access_denied`,
  never a second token. The device code is useless after that.
- **Ownership:** every `/api/device/[deviceId]/…` route goes through `web/src/server/owned-device.ts`
  → `ownedDevice`. It returns 401 without a session, 404 if there is no such device, and 403 if the user does not own its workstation.
  `GET /api/device/list` needs `workstationId` (400 without) and returns 403 for a workstation the user does not own.
- **Grants** (`device_grant`) decide which blueprints the REST sync routes let a device read or
  write. A grant with no blueprint id covers every blueprint in the workstation, including future ones.
  A write needs a `write` grant, and any grant allows reading (`hasGrant`). Grants and scopes are
  **replaced** on every save, never merged.
- **Scopes** (`device.scopes`) are what the token may do beyond blueprint sync:

  | Scope | Checked by |
  |---|---|
  | `code:read` / `code:write` | `web/src/app/api/code/pull/route.ts`, `web/src/app/api/code/push/route.ts` (403 without) |
  | `vision:read` / `vision:write` | `web/src/server/vision.ts` → `deviceFor` / `callerFor` (find vs teach and delete items) |
  | `workstations`, `automations`, `blueprints`, `devices` | MCP tools, see [mcp-access.md](mcp-access.md) |
  | `sessions`, `approvals`, `usage` | Nothing yet |

  Approval gives every scope for write mode, and every `:read` scope for read mode
  (`web/src/server/mcp/scopes.ts` → `defaultScopesForMode`). The approval form never sends custom scopes,
  so change them afterwards through "Manage access". `write` implies `read`.
- **Revoke, then delete.** Revoking sets `status: "revoked"` and clears the token hash, so the next
  request with that token gets 401. `DELETE /api/device/[deviceId]` refuses with 409 `not_revoked`
  until the device is revoked. The Devices card offers only Revoke. Deleting from the UI exists only for MCP tokens.
- **`lastSeenAt`** is updated at most once a minute, without waiting for the write (`LAST_SEEN_EVERY_MS`).
- **Rate limit:** nginx limits `/api/device/code` and `/api/device/token` to 30 requests a minute per IP, burst 15
  (`k8s/base/nginx.conf`), with a 429 `{"error":"slow_down"}` body that `pollForToken` backs off on.
  The "10-per-hour attempt cap" in the `device-auth.ts` comment is not enforced anywhere.

## When it fails
- **`could not start pairing (<status>)`:** wrong server address, or the server is down. Pass the URL or set `JARVIS_CLOUD_URL`.
- **"already paired":** `jarvis pair` refuses when `credentials.json` exists. Run `jarvis unpair -y` first.
- **`the pairing code expired — start again`:** 10 minutes passed without approval. Run `jarvis pair` again.
- **`pairing was denied or already used`:** `access_denied`. The device was revoked before it collected its token,
  or the code was already redeemed. Pair again.
- **Approval page says "unknown, expired, or meant for another account":** 404 `expired_or_unknown`. The code expired,
  was mistyped, or was addressed to a different email. 409 `already_approved` means someone already approved it.
- **400 `blueprint_not_in_workstation`:** a picked blueprint belongs to another workstation.
- **The `/link` page spins on "Checking that code…" forever** when the user has no active workstation.
  Create or select one on `/app/settings` first.
- **A request in the pending list you do not recognise:** anyone who knows your email can create one, and the name is
  theirs to choose. Compare the fingerprint, watch the "new device" badge, and reject it. Rejecting always reports success.
- **401 from any device route:** the token was revoked or the credentials file is stale. Pair again.
- **403 `this device may not push code` / `this device lacks vision:write`:** the scope is missing. Add it under Manage access.
- **`jarvis unpair` did not cut access:** by design, the token stays live on the server. Revoke it under Settings → Devices.

## Related
- [sign-up-and-sign-in.md](sign-up-and-sign-in.md): the approving user needs a session.
- [mcp-access.md](mcp-access.md): scopes over MCP, and tokens minted without pairing.
- [install-and-setup.md](install-and-setup.md): the installer, which leads into pairing.
- [code-projects.md](code-projects.md), [blueprints.md](blueprints.md), [teach-and-find-items.md](teach-and-find-items.md),
  [hand-gestures-and-drawing.md](hand-gestures-and-drawing.md): what a paired device does with its token.
- Module docs: [web/devices-and-pairing](../modules/web/devices-and-pairing/README.md), [tui/cli](../modules/tui/cli/README.md).
