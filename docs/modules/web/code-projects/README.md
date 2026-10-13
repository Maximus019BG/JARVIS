# Code projects

Code: `web/src/app/api/code/`, `web/src/app/(protected)/app/code/` · Verified: 2026-10-13 @ c292f2f

## Purpose
Server side of git-backed project sync. A device's git repo is the source of truth. The server
stores an ordered log of `git bundle`s that any paired device of the same workstation can
replay, plus a text snapshot of the head for a read-only web viewer. The TUI side
(`/code push`, `/code clone`, auto-sync) is in [tui/code-projects](../../tui/code-projects/README.md).

## How it works

### Push (`web/src/app/api/code/push/route.ts` → `POST`)
1. Authenticate the device token (`authenticateDevice`). Require the `code:write` scope
   (`satisfies` from `web/src/server/mcp/scopes.ts`). Pairing grants blueprint sync. Source code
   needs its own consent.
2. Reject bodies over 10 MB (`MAX_BODY_BYTES`). It checks `content-length` first, then the
   actual length, and answers 413.
3. Validate `{ projectId, name, baseSha, headSha, message, bundle, files }`. Shas must be
   40–64 hex characters.
4. If an `idempotency-key` header matches an unexpired `idempotency_key` row, replay the
   stored response.
5. Rate limit: at most 60 `sync_log` rows per device in the last minute, otherwise 429. This
   counter is shared with blueprint and session pushes.
6. Compare with the project row:
   - another workstation's project → 403;
   - `headSha` already equal → 200 `upToDate`;
   - `baseSha` ≠ server head → 409 `diverged` with `serverHead`, `serverVersion` (the client
     must pull first).
7. In one transaction: update `code_project` **where `head_sha = baseSha`** (or insert with
   `onConflictDoNothing` for a new project). Then insert `code_version` (the bundle) and a
   `sync_log` row (`action: "code_push"`). The repeated head check in the `WHERE` is what stops
   two concurrent pushes both winning. The loser gets 409.
8. Store the response under the idempotency key for 24 h.

### Pull (`web/src/app/api/code/pull/route.ts` → `GET`)
Device token with `code:read` (`code:write` implies it). Without `projectId` it lists the
workstation's projects. With `projectId` it returns every bundle with `version` greater than
the version of the commit named by `since`. An unknown or missing `since` gives all bundles,
which is what a clone needs. The client replays them in order.

### Web viewer
- `web/src/app/(protected)/app/code/page.tsx` (server component) lists up to 100 projects
  across all of the user's workstations, newest first. Its empty state explains `/code new`,
  `jarvis init` and `/code push`.
- `web/src/app/(protected)/app/code/[projectId]/page.tsx` shows the head's text files
  (`code_project.files`, selected with `?file=`, defaulting to a README) and the last 50
  versions. It returns 404 rather than 403 when the project is not yours, because whether an
  id exists is itself information.

`POST /api/device/code` is not part of this module, despite its name: it is pairing step 1, documented in
[web/devices-and-pairing](../devices-and-pairing/README.md).

## Files
| File | Responsibility |
|---|---|
| `web/src/app/api/code/push/route.ts` | `POST`: fast-forward-only push of a git bundle plus head text snapshot |
| `web/src/app/api/code/pull/route.ts` | `GET`: list projects, or bundles since a commit |
| `web/src/app/(protected)/app/code/page.tsx` | Code projects table (all of the user's workstations) |
| `web/src/app/(protected)/app/code/[projectId]/page.tsx` | File viewer and version history |

## Interfaces
| Method · path | Auth | Body / query | Response |
|---|---|---|---|
| `POST /api/code/push` | device token, `code:write` | JSON `{ projectId (≤64), name (≤64), baseSha \| null, headSha, message? (≤500), bundle (base64), files?: { path: contents } }`; optional `idempotency-key` header | `{ success, version, head }`; `{ ..., upToDate: true }`; 400 `invalid_request` + `detail`; 403; 409 `{ error: "diverged", serverHead, serverVersion }`; 413 `payload_too_large`; 429 `{ error: "rate_limited", retryAfter: 60 }` |
| `GET /api/code/pull` | device token, `code:read` | none | `{ success, projects: [{ id, name, version, headSha, updatedAt }] }` (this workstation) |
| `GET /api/code/pull?projectId=&since=` | device token, `code:read` | `since` = commit sha, optional | `{ success, name, head, version, bundles: [{ sha, version, bundle }] }`; 404 |

Handlers: `web/src/app/api/code/push/route.ts` → `POST`, `web/src/app/api/code/pull/route.ts` → `GET`. Pages are session-gated by the `(protected)` layout.

## Data and state
- `code_project` (`web/src/server/db/schemas/code_project.ts` → `codeProject`): `id` (made by the
  TUI and kept in the repo's git config, so a rename does not fork it), `headSha`, `version`,
  `files` (JSON text of the head's text files), `workstationId`, `deviceId`.
- `code_version` (`codeVersion`): one row per push. Holds `commitSha`, `baseSha`, `message`, and
  `bundle` (base64 `git bundle` of `baseSha..commitSha`). Unique on `(projectId, commitSha)`.
- Also writes `sync_log` and `idempotency_key` (owned by [web/blueprints](../blueprints/README.md)).

## Depends on / used by
- Depends on: `web/src/server/device-auth.ts`, `web/src/server/mcp/scopes.ts`,
  `web/src/lib/session.ts` → `getSession` (pages), the db client.
- Used by: `tui/src/code/sync.ts` (push/pull),
  and the "Code" sidebar entry in `web/src/config/dashboard-sidebar-nav.ts`.

## Gotchas
- **Fast-forward only.** The server never merges. A 409 means the client must pull, rebase or
  merge locally, and push again.
- `ponytail:` bundles are stored as base64 text in Postgres (`code_version.bundle`). Move them
  to object storage if projects outgrow the 10 MB push cap.
- `ponytail:` pull returns every missing bundle in one response, with no paging. Add paging if
  clones start timing out.
- Pull returns bundles only. The web viewer's `files` snapshot is whatever the client chose to
  send (the TUI leaves out binaries and big files). It is not reconstructed from git.
- The push rate limit counts every `sync_log` row for the device, so heavy blueprint syncing
  also uses up the code push budget.
- The list page has no workstation filter. It shows projects from all of the user's workstations
  regardless of the active one.

## Tests
None in `web/src/__tests__/` cover these routes. Run the suite with `pnpm --filter web test`.
The client side is covered by `tui/test/code-sync.test.ts`; see
[tui/code-projects](../../tui/code-projects/README.md).
