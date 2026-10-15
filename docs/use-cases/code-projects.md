# Code projects

Modules: [tui/code-projects](../modules/tui/code-projects/README.md), [web/code-projects](../modules/web/code-projects/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why
A developer wants the code an agent writes on one machine (often the Pi) to show up on another
machine, or to read it in the browser. A code project is an ordinary git repo in the workspace.
JARVIS syncs it to the owner's server as a log of `git bundle`s, or to a git remote the user
already has (such as GitHub). The repo on the device is always the source of truth. The server
never merges.

## Flow
**Make a project**
1. `jarvis init` (which also scaffolds `.jarvis/`) or `/code init` turns the current folder
   into a project, and `/code new <name>`
   creates `<cwd>/<name>/` with a README and a first commit (`tui/src/code/project.ts` →
   `initProject`, `createProject`). An enclosing repo is reused, so `.git` is never nested, and running it again keeps the id.
2. The project's id (a random UUID) and name are stored in the repo's local git config
   (`jarvis.projectId`, `jarvis.name`). Nothing JARVIS-specific is committed. A repo with no git
   identity gets `jarvis <jarvis@localhost>`.

**Push to the cloud** (`/code push [name]`, the agent's `code_project` tool, or auto-sync)
1. Everything not ignored is committed (`git add -A`). If conflict markers are still in a file,
   the push stops.
2. If `HEAD` equals `refs/jarvis/cloud` (the last commit the cloud and this repo agreed on),
   there is nothing to do.
3. The TUI posts `POST /api/code/push` with the project id, name, base and head shas, the last
   commit message, a base64 bundle of `base..HEAD`, and a text snapshot of tracked files for the
   web viewer (`tui/src/code/sync.ts` → `pushCloud`). The idempotency key is
   `<projectId>:<headSha>`.
4. The server checks the device, its `code:write` scope, size, shape, idempotency and rate
   limit. Then it compares heads (`web/src/app/api/code/push/route.ts` → `POST`):
   - The project belongs to another workstation: 403.
   - The head is already the server's: 200 `upToDate`.
   - The base is not the server's head: 409 `diverged`.
   - Otherwise, in one transaction, it moves the project head (only where the head still equals
     the base), adds a `code_version` row with the bundle and logs a `code_push` in `sync_log`.
5. On a 409 the TUI pulls, merges with real git and retries once. On success it moves
   `refs/jarvis/cloud` to the pushed head.

**Pull and clone**
1. `/code pull [name]` asks `GET /api/code/pull?projectId=…&since=<cloud sha>` for every bundle
   newer than that commit (`web/src/app/api/code/pull/route.ts` → `GET`).
2. If there are bundles, local work is committed first ("jarvis: save before pull"). Then each
   bundle is fetched into `refs/jarvis/cloud` and merged with a normal three-way `git merge`.
   Conflicts are left in the files for the user.
3. `/code clone <name>` lists the workstation's projects, creates `<cwd>/<name>/`, writes the
   project's id into git config and pulls every bundle.

**Git remotes.** `/code push [name] origin` and `/code pull [name] origin` run
`git push --set-upstream` and `git pull --no-rebase` with the user's own git credentials.
Prompts are switched off (`GIT_TERMINAL_PROMPT=0`, ssh `BatchMode=yes`), so a missing credential
fails instead of hanging. The remote must already exist.

**Auto-sync.** With `code.autoSync` on, after every turn each project in the workspace is
committed ("jarvis: auto-sync"), pushed to the cloud when paired and to `origin` when it exists.
A cloud merge conflict is aborted rather than left in the files. Only problems are shown.

**Web viewer.** `/app/code` lists up to 100 projects across all the user's workstations, newest
first. `/app/code/<id>` shows the head's text files (README by default, `?file=` picks another)
and the last 50 versions. Another user's project is a 404.

## Business rules
- **Consent:** the device needs the `code:write` scope to push and `code:read` to pull or list
  (`write` implies `read`). A device approved with write access gets every scope by default,
  including `code:write` (`web/src/server/mcp/scopes.ts` → `defaultScopesForMode`). A read-only
  device gets only `code:read`. Scopes can be changed per device in the web app.
- **Agent use asks first.** `code_project` defaults to `ask` because it sends source off the
  machine. The subject is the action, so `"code_project:push": "allow"` allows only pushes. `list`
  and `status` never ask. `/code` typed by the user does not go through the gate.
- **Fast-forward only:** a push must build on the server's current head. The transaction's
  `WHERE head_sha = base` stops two concurrent pushes from both winning, and the loser gets 409.
- **Names** must match `^[a-z0-9][a-z0-9-]{0,63}$`. The TUI corrects names (case, underscores)
  with `safeName` and refuses path-shaped ones, so a clone cannot write outside the workspace.
- **Size:** push bodies are capped at 10 MB (413). The viewer snapshot skips files over 256 KB,
  binaries, and anything past 2 MB in total. The bundle still carries those files.
- **Rate limit:** 60 `sync_log` rows a minute per device, shared with blueprint and session
  pushes (429, `retryAfter: 60`).
- **Idempotency:** a repeated push with the same key replays the stored response for 24 h.
- **Pull** returns every missing bundle in one response, with no paging. An unknown `since`
  returns all of them.
- **Auto-sync is off by default.** It uploads source on every turn, and `git add -A` commits
  anything `.gitignore` does not cover.

## When it fails
- **403 "this device may not push code":** the device lacks `code:write`. The TUI adds "allow this
  device to sync code in the web app under Settings → Devices".
- **413:** the project is too big for cloud sync. Push it to a git remote instead.
- **409 that comes back after the retry:** the merge had conflicts. The TUI lists the files, and
  the user fixes the markers and runs `/code push` again.
- **"resolve the conflicts first":** conflict markers are still in an unmerged file.
- **"is not on the cloud yet":** a pull for a project that was never pushed (404).
- **"has no git remote":** add the remote with the `git remote add` command the TUI prints.
- **Not paired:** cloud actions fail with "this device is not paired — run `jarvis pair`
  first". `/code status` shows
  "not paired — /pair to connect this device".
- **Auto-sync problems** (conflict, 403, network) appear as error notes after the turn, and
  nothing is overwritten.

## Related
- [Agent turn and permissions](agent-turn-and-permissions.md): how `code_project` is gated.
- [Pair a device](pair-a-device.md): the device token and the access mode chosen at approval.
- [MCP access](mcp-access.md): the same scope vocabulary.
- [Blueprints](blueprints.md): the other thing devices sync, sharing the rate limit.
- Module docs: [tui/code-projects](../modules/tui/code-projects/README.md),
  [web/code-projects](../modules/web/code-projects/README.md).
