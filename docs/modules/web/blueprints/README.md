# Blueprints (web)

Code: `web/src/app/api/blueprint/`, `web/src/app/api/workstation/blueprint/`, `web/src/server/blueprint-*.ts`, `web/src/components/blueprints/`, `web/src/app/(protected)/app/blueprints/`, `web/src/lib/api/blueprint*.ts`, `web/src/lib/blueprint-name.ts`, `web/src/lib/workstation-blueprints.ts` · Verified: 2026-10-14 @ c9135de

## Purpose
The web side of blueprints: the API devices push to and pull from, the browser pages for listing,
viewing, editing and browsing history, and the version mirror in Postgres. It does not have its
own drawing engine. It compiles the tui engine directly, so a drawing edited in the browser is
byte-identical to one edited by the agent. Engine internals are in
[tui/blueprint-system](../../tui/blueprint-system/README.md); user-facing usage is in
[`tui/README.md`](../../../../tui/README.md#blueprints).

## How it works

### Reusing the tui engine (`@blueprint/*`)

The engine in `tui/src/blueprint/` is shared source, not a package, so the TUI, the Pi and the web
cannot drift apart on the schema, geometry or merge rules.

- `web/tsconfig.json` maps `@blueprint/*` to `../tui/src/blueprint/*` and sets
  `allowImportingTsExtensions`, because the tui writes imports as `./schema.ts`.
- `web/next.config.ts` sets `experimental.externalDir` so Next compiles TypeScript outside `web/`.
- `web/jest.config.cjs` mirrors the alias in `moduleNameMapper`
  (`^@blueprint/(.*)$` → `<rootDir>/../tui/src/blueprint/$1`).
- Only files the web imports are compiled. The web imports `schema.ts`, `ops.ts`, `diff.ts`,
  `geom.ts`, `fit.ts`, `check.ts` (which pulls in `tui/src/engineering/formulas.ts`),
  `render-svg.ts`, `render-braille.ts` (MCP only) and `symbols/index.ts`. Importing the Bun-only
  `store.ts`, `sync.ts` or `credentials.ts` fails type-checking with `Cannot find name 'Bun'`, which
  is the intended guard.

### Device sync

A paired device pushes its git history with `POST /api/blueprint/push` and reads it back with
`GET /api/blueprint/pull` (client: `tui/src/blueprint/sync.ts`). Push is fast-forward only: if the
first new commit's `parentSha` is not the server head's `commitSha`, the server answers 409
`diverged` with its head document, and the device merges and pushes a single merge commit. See
[sync-and-history](../../tui/blueprint-system/sync-and-history.md).

### Browser writes

Every browser write goes through `server/blueprint-write.ts` → `appendBlueprintVersion`, which in
one transaction inserts a `blueprint_version` row (with `commitSha: null`), points the
`blueprint` row at it with `syncStatus: "pending"`, and logs a `sync_log` row. History is
append-only; restore adds a copy of an old version instead of rewriting.

The editor sends **ops, not documents**. `components/blueprints/editor/use-editor-doc.ts` →
`useEditorDoc` keeps the last saved document plus a journal of ops; the drawing on screen is
`applyOps(base, journal)`, undo is dropping the last op, and save posts the journal to
`/api/blueprint/[blueprintId]/edit`, where the server runs the same `applyOps` on the stored
document. The client never sends a whole document, so the server never trusts one, and a web save
made while a device pushed is refused (`expectedVersion` mismatch → 409) rather than silently
overwriting the device's work.

### Reading

Every read of the current document goes through `server/blueprint-legacy.ts` → `docFromMetadata`.
It parses the stored JSON with `BlueprintDocSchema`. If it is the old web editor's format
(`{ lines: [{x0,y0,x1,y1}] }` in percent of a pixel canvas), `fromLegacy` converts it to a `px`
document and the response says `legacy: true`. The next save stores the converted document; the
original stays in history.

### Access control

| Caller | Check |
|---|---|
| Browser, one blueprint | `server/blueprint-access.ts` → `requireBlueprint`: session (401), blueprint exists (404), its workstation belongs to the user via `server/ownership.ts` → `ownsBlueprint` (one left-join query; 403). Every `/api/blueprint/[blueprintId]/*` route starts here. |
| Browser, workstation-wide | Session, then workstation ownership (`ownsWorkstation`, or the same `userId` comparison inline). |
| Device | `server/device-auth.ts` → `authenticateDevice` (bearer token), then `hasGrant(deviceId, blueprintId, "read" \| "write")` against `device_grant` (a grant with no blueprint id covers the whole workstation), and the blueprint must be in the device's workstation. |

The `[workstationId]` and `[userId]` segments in page URLs are only used to build links. They
grant nothing; access is decided by the API.

## Files

| File | Responsibility |
|---|---|
| `web/src/app/api/blueprint/push/route.ts` | Device push: validate, rate-limit, grant check, fast-forward or 409, insert all new versions in one bulk `INSERT`. |
| `web/src/app/api/blueprint/pull/route.ts` | Device pull: list reachable blueprints, or return versions of one (`since` lookup and commits query both scoped to the blueprint in SQL). |
| `web/src/app/api/blueprint/create/route.ts` | Create a blueprint from the browser; row id equals document id. |
| `web/src/app/api/blueprint/[blueprintId]/route.ts` | Get the current document (legacy-converted); delete the blueprint. |
| `web/src/app/api/blueprint/[blueprintId]/edit/route.ts` | Apply an op batch with `applyOps` and append a version. Optional rename. |
| `web/src/app/api/blueprint/[blueprintId]/versions/route.ts` | History timeline with device and author, without documents. |
| `web/src/app/api/blueprint/[blueprintId]/at/[sha]/route.ts` | One historical document by sha or `v<n>`. |
| `web/src/app/api/blueprint/[blueprintId]/diff/route.ts` | `diffDocs` between two versions, plus both documents. |
| `web/src/app/api/blueprint/[blueprintId]/restore/route.ts` | Append a copy of an old version as the new head. |
| `web/src/app/api/blueprint/[blueprintId]/clone/route.ts` | Copy the current document into a new blueprint with its own history. |
| `web/src/app/api/workstation/blueprint/list/[workstationId]/route.ts` | Every blueprint row in a workstation, with `lastModified`. |
| `web/src/app/api/workstation/blueprint/recent/route.ts` | Most recently updated blueprints across the user's workstations. |
| `web/src/app/api/workstation/blueprint/stats/route.ts` | Totals, active (30 days), per-workstation counts, 7-day creation histogram. Two concurrent queries. |
| `web/src/server/blueprint-access.ts` | `requireBlueprint`: session plus ownership, as an HTTP response. |
| `web/src/server/blueprint-write.ts` | `appendBlueprintVersion`: the one web-side write path (used by routes and MCP). |
| `web/src/server/blueprint-legacy.ts` | `docFromMetadata`, `fromLegacy`: read any stored format. |
| `web/src/lib/api/blueprints.ts` | `blueprintsApi` axios client (list, create, delete, clone, stats, recent), `Blueprint` type, `applyBlueprintFilters` (client-side search, filter and sort). |
| `web/src/lib/api/blueprint-versions.ts` | `blueprintVersionsApi` (list, at, diff, restore) and its types. Also holds `devicesApi`, `DeviceRow`, `PendingDeviceRequest` for the devices UI. |
| `web/src/lib/blueprint-name.ts` | `BLUEPRINT_NAME_RE`, `isValidBlueprintName`, `slugifyBlueprintName`: the same name rule as `tui/src/blueprint/store.ts` → `safeName`. |
| `web/src/lib/workstation-blueprints.ts` | `useWorkstationBlueprints`: React Query hook returning ids and names for access checkbox lists. |
| `web/src/app/(protected)/app/blueprints/page.tsx` | Blueprint list page: stats, filters, paged grid (12 per page), create dialog, detail modal, delete with type-to-confirm, clone. |
| `web/src/app/(protected)/app/blueprints/[workstationId]/[blueprintId]/[userId]/view/page.tsx` | Renders `BlueprintViewer`. |
| `web/src/app/(protected)/app/blueprints/[workstationId]/[blueprintId]/[userId]/edit/page.tsx` | Renders `BlueprintEditor`. |
| `web/src/app/(protected)/app/blueprints/[workstationId]/[blueprintId]/[userId]/history/page.tsx` | Breadcrumbs plus `BlueprintHistory`. |
| `web/src/app/(protected)/app/blueprints/[workstationId]/[blueprintId]/[userId]/error.tsx` | Error boundary for view, edit and history; shows the message and digest. |
| `web/src/components/blueprints/canvas.tsx` | `BlueprintCanvas`: the one canvas renderer (view, edit, diff tints, ghost layer, pan/zoom, grid, marquee). Also `hitTest`, `entitiesWithin`, `gridStep`. |
| `web/src/components/blueprints/blueprint-editor.tsx` | `BlueprintEditor`: tools, pointer and keyboard handling, side panels, save. |
| `web/src/components/blueprints/editor/use-editor-doc.ts` | `useEditorDoc`: base document plus op journal, undo/redo, save with `expectedVersion`. |
| `web/src/components/blueprints/editor/toolbar.tsx` | `EditorToolbar`, `TOOLS` (with lucide icons), `Tool`. |
| `web/src/components/blueprints/editor/symbol-palette.tsx` | `SymbolPalette` (search, SVG thumbnails via `toSvg`, rotate and scale) and `symbolOp`, which emits a `place` op. |
| `web/src/components/blueprints/editor/properties-panel.tsx` | Edits the selection with `update` and `restyle` ops, the sheet with `setView`. Values commit on blur or Enter (one undo step). |
| `web/src/components/blueprints/editor/layers-panel.tsx` | Active layer, visibility, `addLayer` and `setLayer` ops. |
| `web/src/components/blueprints/editor/check-panel.tsx` | Runs `checkDoc` in the browser on the unsaved document; click a finding to select it. |
| `web/src/components/blueprints/blueprint-viewer.tsx` | `BlueprintViewer`: read-only canvas with layer toggles and a general check summary. |
| `web/src/components/blueprints/blueprint-history.tsx` | `BlueprintHistory`: version list, single-version view, two-version diff overlay, restore. |
| `web/src/components/blueprints/blueprint-create-dialog.tsx` | `BlueprintCreateDialog`: name (slugified), sheet preset (A4, A3, custom) and units with conversion. |
| `web/src/components/blueprints/blueprint-card.tsx` | `BlueprintCard`: one grid card with its action menu. |
| `web/src/components/blueprints/blueprint-grid.tsx` | `BlueprintsGrid`: lays out cards. |
| `web/src/components/blueprints/blueprint-filters.tsx` | `BlueprintFiltersComponent`: search, sync status, modified window, sort. |
| `web/src/components/blueprints/blueprint-detail-modal.tsx` | `BlueprintDetailModal`: tabbed details (overview, configuration, metadata, activity) with actions. |
| `web/src/components/blueprints/blueprint-header.tsx` | `BlueprintsHeader`: page title and refresh. |
| `web/src/components/blueprints/blueprint-stats.tsx` | `BlueprintStats`: stat cards; also used on the dashboard (`web/src/app/(protected)/app/page.tsx`). |
| `web/src/components/blueprints/blueprint-skeleton.tsx` | `BlueprintCardSkeleton`, `BlueprintGridSkeleton`. |
| `web/src/components/blueprints/README.md` | Old, stale component notes (see Gotchas). |

## Interfaces

### Device routes (bearer device token)

| Method · path | Auth | Body / query | Response |
|---|---|---|---|
| `POST /api/blueprint/push` | `authenticateDevice`; blueprint must be in the device's workstation (403); `hasGrant(..., "write")` (403, logged as `denied`). 60 pushes/min per device (429). Body ≤ 2 MB (413). | `{ blueprintId (≤ 64), name (≤ 64), commits: [{ sha, parentSha \| null, message, at?, doc: BlueprintDoc }] (1..200) }`. Optional `idempotency-key` header: a replay within 24 h returns the stored reply. | 200 `{ success, applied, head, version }`; 200 `{ success, applied: 0, head, upToDate: true }` when every sha is known; 409 `{ error: "diverged", serverHead, serverParent, serverVersion, serverDoc }`; 400 `invalid_request`. Creates the blueprint row on first push. |
| `GET /api/blueprint/pull` | `authenticateDevice` | none | `{ success, blueprints: [{ id, name, version, updatedAt }] }`: blueprints in the device's workstation it may read (`readableBlueprintIds`). |
| `GET /api/blueprint/pull?blueprintId=…[&since=<sha>]` | `hasGrant(..., "read")` (403); same workstation (403); 404 if missing | `since` = a known commit sha | `{ success, name, commits: [{ sha, parentSha, message, version, at, doc }], truncated }`, oldest first, at most 200. |

### Browser routes (session cookie)

| Method · path | Auth | Body / query | Response |
|---|---|---|---|
| `POST /api/blueprint/create` | session; `ownsWorkstation` (403) | `{ workstationId, name (BLUEPRINT_NAME_RE), units? = "mm", viewBox? = [0,0,297,210] }` | 201 `{ success, id, name, version, createdBy }`; 409 if the name exists in that workstation; 400 for a non-positive sheet. |
| `GET /api/blueprint/[blueprintId]` | `requireBlueprint` | none | `{ success, id, name, workstationId, version, syncStatus, updatedAt, doc \| null, legacy }` |
| `DELETE /api/blueprint/[blueprintId]` | `requireBlueprint` | none | `{ success }`. Versions and sync logs go by cascade. |
| `POST /api/blueprint/[blueprintId]/edit` | `requireBlueprint` | `{ ops: Op[] (≤ 2000), message? (≤ 500), name?, expectedVersion? }` | `{ success, version, summary, doc }` (the stored, serialized doc). 409 `{ error: "stale", serverVersion }`; 400 if no ops and no name; 422 if unreadable or `applyOps` throws. |
| `GET /api/blueprint/[blueprintId]/versions` | `requireBlueprint` | none | `{ success, blueprint: { id, name, version }, versions: [{ id, version, commitSha, parentSha, message, deviceId, createdBy, createdAt, device, author }] }`, newest first. |
| `GET /api/blueprint/[blueprintId]/at/[sha]` | `requireBlueprint` | `sha` = commit sha or `v<n>` | `{ success, version, commitSha, message, createdAt, doc }`; 404. |
| `GET /api/blueprint/[blueprintId]/diff?a=…&b=…` | `requireBlueprint` | `a`, `b` = sha or `v<n>` | `{ success, summary, counts, a: { version, commitSha, doc }, b: {…}, changes: [{ kind, id, type, layer }], layers: [{ kind, id }], viewBox }` |
| `POST /api/blueprint/[blueprintId]/restore` | `requireBlueprint` | `{ ref }` = sha or `v<n>` | `{ success, version, restoredFrom }`; 409 `already_current`; 422 if the stored version is invalid. |
| `POST /api/blueprint/[blueprintId]/clone` | `requireBlueprint` | `{ name? }` (optional body) | 201 `{ success, id, name }`. Default name `<name>-copy`, then `-2`, `-3`… |
| `GET /api/workstation/blueprint/list/[workstationId]` | session; workstation's `userId` must match (403) | `recentOnly=true` (currently no effect) | Array of blueprint rows plus `lastModified`. Bare array, not wrapped. |
| `GET /api/workstation/blueprint/recent` | session | `limit` (default 10) | Array of `{ id, name, workstationId, workstationName, createdBy, createdAt, updatedAt }` |
| `GET /api/workstation/blueprint/stats` | session | none | `{ total, active, byWorkstation, recentActivity: [{ date, count }] }` |

### Pages

| URL | Component |
|---|---|
| `/app/blueprints` | List page for the active workstation (`useActiveWorkstation`). |
| `/app/blueprints/[workstationId]/[blueprintId]/[userId]/view` | `BlueprintViewer` |
| `/app/blueprints/[workstationId]/[blueprintId]/[userId]/edit` | `BlueprintEditor`: tool keys from `TOOLS`, ⌘S save, ⌘Z / ⇧⌘Z undo/redo, ⌘A select all, arrows nudge by the grid step (×10 with shift), space to pan, Delete removes the selection. Warns before leaving with unsaved changes. |
| `/app/blueprints/[workstationId]/[blueprintId]/[userId]/history` | `BlueprintHistory` |

## Data and state

Tables (schemas in `web/src/server/db/schemas/`; the [Database](../database/README.md) module owns
migrations):

| Table | Schema file | Columns that matter here |
|---|---|---|
| `blueprint` | `blueprint.ts` | `id` (= document `id`), `name`, `workstation_id` (index `blueprint_workstation_idx`), `created_by`, `metadata` (current document JSON), `version` (head version number), `hash` (sha256 of `metadata`), `sync_status` (`synced` after a device push, `pending` after a web write), `last_synced_at`, `device_id` (last pusher). |
| `blueprint_version` | `blueprint_version.ts` | `blueprint_id`, `version`, `metadata`, `hash`, `commit_sha` (null for web writes), `parent_sha`, `message`, `device_id`, `created_by`, `created_at`. Unique `(blueprint_id, commit_sha)` makes a re-push a no-op; unique `blueprint_version_version_unique` `(blueprint_id, version)` stops two concurrent writers both taking version N. Append-only. |
| `sync_log` | `sync_log.ts` (re-exported from `blueprint.ts`) | One row per push, denied push and web write: `action`, `direction` (`up`/`down`), `status`, `version_before`, `version_after`. Also the push rate limiter's counter. |
| `idempotency_key` | `idempotency_key.ts` | Stored push replies, 24 h expiry. |
| `device_grant` | `device_grant.ts` | Read by `hasGrant`; owned by [Devices and pairing](../devices-and-pairing/README.md). |

Client state: the editor's op journal and redo stack live in React state only (lost on reload; a
`beforeunload` prompt guards it). No server-side caches.

## Depends on / used by

**Depends on:** the tui engine via `@blueprint/*` ([tui/blueprint-system](../../tui/blueprint-system/README.md)),
`~/lib/auth` (session), `~/server/ownership`, `~/server/device-auth`, `~/server/db`, shadcn
components in `~/components/ui`, `~/lib/workstation-hooks`, `~/lib/type-to-confirm-store`.

**Used by:**
- The tui sync client (`tui/src/blueprint/sync.ts`) calls push and pull.
- [MCP](../mcp/README.md): `web/src/server/mcp/tools/blueprints.ts` uses the engine and
  `appendBlueprintVersion`.
- [Devices and pairing](../devices-and-pairing/README.md) and [Auth and accounts](../auth-and-accounts/README.md):
  device-access and MCP-token forms use `useWorkstationBlueprints` and `devicesApi`.
- [Frontend shell](../frontend-shell/README.md): the dashboard uses `BlueprintStats` and
  `blueprintsApi.getRecentBlueprints`.

## Gotchas

- **Never import `store.ts`, `sync.ts` or `credentials.ts` through `@blueprint/*`.** They are
  Bun-only. That is also why `lib/blueprint-name.ts` duplicates the name regex instead of
  importing `safeName`.
- **The web keeps its own copies of shared engine helpers.** `canvas.tsx` re-implements
  `hitTest`, `entitiesWithin` and `gridStep` (same code as `tui/src/blueprint/pick.ts`), and
  `editor/toolbar.tsx` plus `blueprint-editor.tsx` re-implement `TOOLS` and `shapeFrom` from
  `tui/src/blueprint/draw.ts`. Change both sides together, or switch the web to import them.
- **Device-pushed versions are not canonical text.** Push stores `JSON.stringify(commit.doc)` of
  the Zod-parsed document; web writes store `serialize(doc)`. The same drawing can therefore have
  two different `hash` values depending on who wrote it. `appendBlueprintVersion` requires
  `serialize` output.
- **Concurrent writes to one blueprint:** the loser's transaction (push or `appendBlueprintVersion`)
  hits `blueprint_version_version_unique` and rolls back. Push does not catch it, so that device
  gets a 500 and must push again.
- **Rename through `/edit` does not check for a name clash** in the workstation; create and clone
  do. Names are filenames on every syncing device.
- `recentOnly` on the list route is a TODO and returns everything.
- Re-pushing known commits is safe: the unique index plus the "all shas known" check make it a
  no-op, and the idempotency key replays lost replies.
- `lib/api/blueprints.ts` adds a `localStorage` `authToken` header if present; auth actually uses
  the session cookie.
- `web/src/components/blueprints/README.md` describes `/api/blueprints/*` endpoints, mock data,
  create and edit pages and an index barrel that do not exist. Trust this page and
  the code instead.

## Tests

| File | Covers |
|---|---|
| `web/src/__tests__/blueprint-filters.test.ts` | `applyBlueprintFilters`. |
| `web/src/__tests__/blueprint-legacy.test.ts` | `docFromMetadata` (new, legacy and unreadable rows), `isValidBlueprintName`, `slugifyBlueprintName`. |

Run with `cd web && pnpm test -- blueprint`. The engine itself is tested in `tui/test/blueprint-*`
(see [tui/blueprint-system](../../tui/blueprint-system/README.md#tests)). The API routes have no
tests.
