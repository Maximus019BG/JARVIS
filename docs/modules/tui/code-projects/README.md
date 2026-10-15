# Code projects

Code: `tui/src/code/` · Verified: 2026-10-14 @ c9135de

## Purpose
Turns git repos inside the workspace into "code projects" that sync to the JARVIS cloud (shown in
the web app) or to a git remote the user set up, such as GitHub. One implementation serves the
`/code` slash command, the `code_project` agent tool, `jarvis init`, and per-turn auto-sync.
The server side is [web/code-projects](../../web/code-projects/README.md).

## How it works

**Identity** (`project.ts`): a project is an ordinary repo in the workspace, not a store in the
data dir, because the agent's file tools are clamped to `cwd`. Its id and name live in the repo's
local git config (`jarvis.projectId`, `jarvis.name`); the last commit the cloud and this repo
agreed on is the ref `refs/jarvis/cloud` (`CLOUD_REF`). Nothing jarvis-specific is committed.
- `initProject(dir)`: reuses the enclosing repo if there is one (never nests `.git`), otherwise
  `git init --initial-branch=main`; sets a random UUID and a `safeName` name. Idempotent.
- `createProject(cwd, name)`: `cwd/<name>/` as a new repo with a README and first commit.
- `findProjects(cwd)`: the workspace itself plus direct children that have a `.git`.
- `ensureIdentity` sets `jarvis@localhost` / `jarvis` as the repo's git identity when none is
  configured (a fresh Pi has none and every commit would fail).

**Push to cloud** (`sync.ts` → `pushCloud`):
1. `commitAll` (refuses if conflict markers are still in an unmerged file).
2. If `HEAD == refs/jarvis/cloud`, nothing to do.
3. `POST /api/code/push` with `{projectId, name, baseSha, headSha, message, bundle, files}`:
   `bundle` is `git bundle create base..HEAD` (or all of `HEAD`) as base64; `files` is a text
   snapshot of tracked files for the web viewer (`snapshot`: skips files over 256 KB, binaries,
   and anything past 2 MB total). Idempotency key `<projectId>:<headSha>`.
4. On `409` (someone pushed first): `pullCloud`, then retry once. If the merge conflicted, return
   the conflict report instead of pushing.
5. On success, move `refs/jarvis/cloud` to the pushed head.

**Pull from cloud** (`pullCloud`): `GET /api/code/pull?projectId=…&since=<cloud sha>`. If there
are bundles: commit local work ("jarvis: save before pull"), then `applyBundles` fetches each
bundle into `CLOUD_REF` and runs a normal `git merge` against it, so divergence gets a real
three-way merge and conflicts are left in the files. A fresh clone hard-resets to `CLOUD_REF`.
`clone` runs the server-listed name through `safeName` before joining it to `cwd`, so a
path-shaped name from the server is refused rather than written outside the directory.
With `abortOnConflict` (auto-sync) the merge is aborted and an error is thrown instead.

**Git remotes** (`pushRemote`/`pullRemote`): the remote must already exist. Commits, then runs
`git push --set-upstream <remote> HEAD` or `git pull --no-rebase` via `gitRemote`, which is async
(so the TUI does not freeze) with `GIT_TERMINAL_PROMPT=0` and `ssh -o BatchMode=yes` unless
`GIT_SSH_COMMAND` is set. Credentials are the user's own git setup.

**Auto-sync** (`autoSync`), called by `ui/use-turn.ts` after each turn when `code.autoSync` is on:
for every project, commit "jarvis: auto-sync", push to the cloud if paired (aborting on
conflict), and push to `origin` if it exists. Only problems are returned.

**Entry points** (`tools.ts` → `codeAction`): dispatches `new`, `init`, `list`, `status`, `push`,
`pull`, `clone`. `code_project` gates every action except `list`/`status`, and is `ask` in
`DEFAULT_RULES`: it sends source off the machine.

## Files
| File | Responsibility |
|---|---|
| `tui/src/code/project.ts` | Local git side: `projectAt`, `initProject`, `createProject`, `findProjects`, `resolveProject`, `commitAll`, `snapshot`, `bundleSince`, `applyBundles`, `gitRemote`, `headSha`, `cloudSha`, `setCloudSha`, `CLOUD_REF` |
| `tui/src/code/sync.ts` | Cloud and remote sync: `pushCloud`, `pullCloud`, `pushRemote`, `pullRemote`, `push`, `pull`, `clone`, `list`, `status`, `autoSync` |
| `tui/src/code/tools.ts` | `codeAction` (shared by `/code` and the tool), `codeProjectTool`, `CODE_ACTIONS` |

## Interfaces

**Agent tool `code_project`**: `action` (`new`/`init`/`list`/`status`/`push`/`pull`/`clone`),
`name?` (optional when the workspace has one project), `target?` (`"cloud"` default, or a git
remote name), `message?` (commit message on push). Permission: tool `code_project`, subject = the
action, so `"code_project:push": "allow"` works. Deferred under `lazyTools`.

**Slash command** `/code new <name> · init · list · status [name] · push [name] [remote] · pull
[name] [remote] · clone <name>` (parsed in `ui/code-command.ts`).

**CLI**: `jarvis init` calls `initProject(cwd)`.

**Config**: `code.autoSync` (default `false`).

**Web API endpoints called** (Bearer device token, via `blueprint/sync.ts` → `call`):

| Method · path | Used by | Notes |
|---|---|---|
| `GET /api/code/pull` | `list`, `status`, `clone` | → `{projects: [{id, name, version, headSha, updatedAt}]}` |
| `GET /api/code/pull?projectId=&since=` | `pullCloud` | → `{name, head, version, bundles: [{sha, version, bundle}]}`; 404 = not on the cloud yet |
| `POST /api/code/push` | `pushCloud` | body above, header `idempotency-key`; → `{version, head, upToDate?}`; 409 = diverged, 403 = device lacks code access, 413 = too big |

## Data and state
- Per repo: git config `jarvis.projectId`, `jarvis.name`, possibly `user.email`/`user.name`;
  ref `refs/jarvis/cloud`.
- Temporary bundle files in `$TMPDIR/jarvis-bundle-*`, removed after use.
- Reads `~/.local/share/jarvis/credentials.json` (`readCredentials`/`requireCredentials`).
- Env: `GIT_SSH_COMMAND` (respected), `GIT_TERMINAL_PROMPT` (forced to `0` for remote calls).

## Depends on / used by
- Depends on: `blueprint/store.ts` (`git`, `gitOrThrow`, `safeName`), `blueprint/sync.ts`
  (`call`), `blueprint/credentials.ts`, [config](../config/README.md) (`Config`),
  [tools](../tools/README.md) (`ToolContext`), the `git` binary.
- Used by: [tools](../tools/README.md) (`index.ts` registers `code_project`),
  [cli](../cli/README.md) (`jarvis init`), [UI](../ui/README.md) (`code-command.ts`,
  `use-turn.ts` for `autoSync`).

## Gotchas
- Names go through `safeName`, which corrects rather than rejects (e.g. case, underscores).
- `commitAll` uses `git add -A`: everything not ignored in the project gets committed, on push,
  pull and every auto-sync. Make sure `.gitignore` covers secrets and build output.
- Pull always commits local changes first, so there is no dirty-tree pull.
- Auto-sync uploads source on every turn; it is off by default and the device also needs code
  access granted in the web app (a 403 says so).
- Cloud sync is capped server-side (413); the error suggests pushing to a git remote instead.
- `push` with a `target` other than `cloud` treats it as a git remote name; a missing remote is an
  error that prints the `git remote add` command.

## Tests
Run from `tui/`: `bun test test/code-sync.test.ts`.

| Test | Covers |
|---|---|
| `tui/test/code-sync.test.ts` | push, clone, divergent merges, conflicts, abort-on-conflict, `init` reusing the enclosing repo, pushing to a plain git remote |
