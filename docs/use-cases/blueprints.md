# Blueprints

Modules: [tui/blueprint-system](../modules/tui/blueprint-system/README.md), [web/blueprints](../modules/web/blueprints/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why
A blueprint is a 2D technical drawing: a wiring schematic, a floor plan or an IoT board layout.
You draw it by hand in the terminal or the browser, place library symbols (resistors, doors,
sensors), and let JARVIS route the wires. You can also ask the agent to draw it for you. Every
save is a version you can view, diff and restore. A paired device keeps its own git copy and
syncs it with the web, so the same drawing can be edited at the desk, on the Pi and in Chrome.

## Flow

### Draw in the terminal
1. The user types `/blueprint <name>`. A bare `/blueprint` opens a picker, or a how-to panel when
   the store is empty (`tui/src/ui/blueprint-command.ts`). The name is cleaned by
   `tui/src/blueprint/store.ts` → `safeName`, and a missing blueprint is created empty and
   committed as `created`.
2. The fullscreen editor (`tui/src/ui/components/blueprint-editor.tsx`) keeps a journal of ops.
   The screen shows `applyOps(saved doc, journal)`. `u` undoes, `ctrl+r` redoes, `w` saves.
   Closing with `esc` or `q` also saves, so a stroke on screen is never thrown away silently.
3. Saving calls `writeDoc`: it writes `<name>.blueprint.json`, then makes one git commit,
   `<name>: edit <name> in the terminal`. A save with no change makes no commit.
4. The agent route works the same way. The `blueprint_edit` and `blueprint_symbol` tools apply
   the ops first, then ask for permission, then commit. A batch that fails never reaches the
   prompt or the disk. See [agent turn and permissions](agent-turn-and-permissions.md).

### Draw in the browser
1. On `/app/blueprints` the user creates a blueprint: a name, a sheet (A4, A3 or custom) and units.
   `POST /api/blueprint/create` makes a row whose id equals the document id (`bp_` + 16 chars)
   and writes version 1 with the message `create`.
2. The editor (`web/src/components/blueprints/editor/use-editor-doc.ts` → `useEditorDoc`) loads
   `GET /api/blueprint/[blueprintId]`. Each tool click becomes an op. The op is tried with
   `applyOps` first, so a bad op shows a toast and never joins the journal.
3. Save (button or ⌘S) posts the journal plus `expectedVersion` to
   `web/src/app/api/blueprint/[blueprintId]/edit/route.ts`. The server replays the same ops on
   the stored document, serializes it, and appends a version. The reply carries the stored
   document, which becomes the editor's new base.

### Why both sides draw the same thing
The web has no drawing engine of its own. `@blueprint/*` resolves to `tui/src/blueprint`, so the
browser, the API, MCP and the terminal all run the same `applyOps`, the same symbol libraries,
the same `serialize` and the same `merge3`. After the literal ops, `applyOps` always runs the
same four passes: reroute stale wires, auto-wire, junction dots, label placement. Callers never
send wire coordinates. The browser and the server each replay the journal, so every pass must
give the same result twice, or the stored drawing would differ from the one the user saw.

### Sync a device with the web
1. The device must be paired (`jarvis pair`, see [pair a device](pair-a-device.md)). Sync sends
   the device token that pairing stored.
2. The agent calls `blueprint_sync` with `push`, `pull` or `status`. `push` and `pull` ask for
   permission first. There is no other sync command and no background sync.
3. **Push** (`tui/src/blueprint/sync.ts` → `push`) sends up to 200 local commits, oldest first,
   to `POST /api/blueprint/push`, with the idempotency key `<doc id>:<last sha>`.
4. The server skips commits it already has. If none are new, it answers `upToDate`. If the
   first new commit's parent is the server head, it fast-forwards: one bulk insert of every new
   version, and the blueprint is marked `synced`. Otherwise it answers 409 `diverged` with its
   head document.
5. On 409 the device merges: `merge3(base, local, server)`, where the base is the local commit
   equal to the server head's parent, or else the oldest local commit. It commits
   `merge <serverHead>` (with `— N conflict(s)` when there are conflicts), then pushes only that
   merge commit, parented on the server head.
6. **Pull** fetches the whole server history for the blueprint's id. If the server already has
   the local head, the device takes the server document (`pull server v<N>`). If not, the
   device has unpushed work, so it merges against the oldest local commit (`merge server v<N>`).

### History
- Device side: every save is a git commit. The agent's `blueprint` tool lists the last 20
  commits, and `blueprint_view at:<sha>` renders an old one.
- Web side: the history page lists versions newest first, with the device or the author.
  It shows one version, diffs two of them (by sha or `v<n>`), and restores one.
  Restore never rewrites history. It appends a copy of the old version as the new head
  (`restore v<n>`).

## Business rules
- **Names** are file names on every syncing device: `^[a-z0-9][a-z0-9-]{0,63}$`. The terminal
  turns `Front Panel` into `front-panel` and refuses anything with `/`, `\` or `..`
  (`tui/src/blueprint/store.ts` → `safeName`). The web uses the same regex
  (`web/src/lib/blueprint-name.ts`). Create and clone refuse a name already used in the
  workstation (409). Renaming in the editor does not check this.
- **Identity is the document `id`, not the name.** Sync keys on it, so a rename does not fork
  history. A clone gets a new id and starts its own history at v1.
- **Web writes are append-only.** Create, edit, restore, clone and MCP edits all go through
  `web/src/server/blueprint-write.ts` → `appendBlueprintVersion`. It stores a version with no
  commit sha, sets `sync_status` to `pending` and logs a `sync_log` row. Because that version
  has no sha the device knows, the device's next push gets a 409 and merges. That is how a web
  edit and a device edit made at the same time both survive.
- **Merges never drop geometry** (`tui/src/blueprint/merge.ts` → `merge3`). An entity both sides
  changed keeps ours under its id and adds theirs as `<id>-b`, with a conflict. An edit beats a
  delete, with a conflict. Layers take ours; the sheet becomes the union of both; nets are
  rebuilt from their port pairs.
- **Edit limits:** at most 2000 ops and a 500-character message per save. `expectedVersion` must
  match the head, or the save is refused with 409 `stale`.
- **Push limits** (`web/src/app/api/blueprint/push/route.ts`): body at most 2 MB, 1 to 200
  commits, blueprint id and name at most 64 characters, 60 pushes per minute per device
  (counted from `sync_log`). A reply is stored under its idempotency key for 24 hours, and a
  retry with the same key gets the stored reply.
- **Pull limit:** at most 200 versions per answer. The device refuses a `truncated` answer
  rather than guessing.
- **Who may read and write:**
  - Browser: a signed-in session whose user owns the blueprint's workstation
    (`web/src/server/blueprint-access.ts` → `requireBlueprint`). The ids in page URLs grant nothing.
  - Device: the blueprint must be in the device's own workstation, and `device_grant` must allow
    it (`web/src/server/device-auth.ts` → `hasGrant`). A grant with no blueprint id covers the
    whole workstation, including blueprints made later. Any grant allows read; push needs a
    `write` grant. Grants are chosen when the device is approved and changed under
    Settings → Devices. A device with only per-blueprint grants cannot create a new
    blueprint by pushing it.
  - MCP: the token needs `blueprints:read` or `blueprints:write`, and the same `hasGrant`
    check. See [MCP access](mcp-access.md).
- **The workstation link.** A device pushes into the workstation it was paired to: the server
  takes it from the device token. The `blueprint.workspace` config key (default `default`) only
  names the local folder, `<data dir>/blueprints/<workspace>`. It does not choose a web
  workstation.
- **Deletes do not sync.** Deleting on the web removes the row, its versions and its sync log
  (cascade). Deleting on a device is a local git commit only.
- A device can only pull or push a blueprint whose file it already has. `pull` reads the local
  file to learn the document id. A blueprint created in the browser does not reach a device
  that has never had it.

## When it fails
| What happens | What the user sees | How to recover |
|---|---|---|
| Browser save after a device push | 409 `stale`; toast "This blueprint changed elsewhere" with a Reload button | Reloading drops the unsaved journal. Note the change, reload, redraw. |
| A bad op in the browser | Toast with the engine's message; the op is not added | Fix the input. |
| Server cannot apply the ops, or the stored document is unreadable | 422 with the message | The stored document is unchanged. |
| Device not paired | "this device is not paired — run `jarvis pair` first" | Pair the device. |
| No write grant | 403, logged as a `denied` push | Grant write under Settings → Devices. |
| Blueprint belongs to another workstation | 403 | Pair the device to the right workstation. |
| More than 60 pushes in a minute | 429 `rate_limited`, `retryAfter: 60` | Wait a minute. |
| Two writers take the same version number | The loser's insert hits `blueprint_version_version_unique`; push gets a 500 | Push again. |
| Pull history over 200 versions | `the server has more history than one pull can carry` | No fix in code today. |
| Old web-editor format | Loaded as a `px` document with `legacy: true` | The next save stores the converted document; the original stays in history. |
| Merge conflict | The tool reply lists conflicts and renames such as `e1 → e1-b` | Delete the copy you don't want and save. |

**Known issue: false conflicts after a merge or a pull.** The commits a device makes by merging
or pulling never reach the server under their own shas. So the next push after a merge, or after
a fast-forward pull and a local edit, gets a 409 again. It merges against the oldest local
commit, and an entity edited only locally comes back duplicated as `<id>-b`. A scratch run of the
sync client showed this. Until it is fixed, check for `-b` entities after syncing.

## Related
- [Pair a device](pair-a-device.md), [MCP access](mcp-access.md),
  [hand gestures and drawing](hand-gestures-and-drawing.md) (drawing by hand on the Pi),
  [agent turn and permissions](agent-turn-and-permissions.md).
- Engine internals: [data model](../modules/tui/blueprint-system/data-model.md),
  [editing](../modules/tui/blueprint-system/editing.md),
  [rendering](../modules/tui/blueprint-system/rendering.md),
  [sync and history](../modules/tui/blueprint-system/sync-and-history.md).
- Web routes and tables: [web/blueprints](../modules/web/blueprints/README.md).
