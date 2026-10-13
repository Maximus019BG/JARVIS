# Blueprint sync and history

Part of [Blueprint system](README.md). Code: `tui/src/blueprint/{store,sync,credentials}.ts` · Verified: 2026-10-13 @ c292f2f

The device's local git repo is the source of truth. The web keeps an append-only mirror of it
(`blueprint_version` rows) so history can be shown without a checkout. Usage:
[`tui/README.md`](../../../../tui/README.md#syncing-to-the-cloud). Server side:
[web/blueprints](../../web/blueprints/README.md).

## Local store (`store.ts`)

This is the only file in the folder that touches the filesystem or spawns processes.

**Location:** `store.ts` → `blueprintRoot(config)` returns `config.blueprint.dir`, else
`<dataDir>/blueprints/<config.blueprint.workspace>`. It is its own git repo, kept outside the
project so it never nests a `.git` in the user's repo.

| Export | What it does |
|---|---|
| `safeName(name)` | The path-traversal defence (blueprint tools do not go through the workspace sandbox). Accepts `^[a-z0-9][a-z0-9-]{0,63}$` and strips a `.blueprint.json` suffix. Otherwise it slugifies (`Front Panel` → `front-panel`), but refuses anything with `/`, `\` or `..` outright. Idempotent. |
| `ensureRepo(root)` | `git init --initial-branch=main` on first use and sets a local `user.name`/`user.email`, because a fresh Pi has no global git identity. |
| `readDoc(root, name)` | `parseDoc` on the file. A missing file gives an error that lists up to 20 existing names and says how to create one. |
| `readOrCreate(root, name)` | `readDoc`, or `emptyDoc` if missing. Every writing tool uses this so a model does not need a separate `create` call. |
| `writeDoc(root, name, doc, message)` | Writes `serialize(doc)`, stages it, and commits `"<name>: <message>"`. If nothing changed, it makes no commit and returns the current HEAD (or `"unchanged"`). Returns the short sha. |
| `deleteDoc(root, name)` | `git rm` plus a commit. |
| `exists`, `listBlueprints(root)` | `listBlueprints` returns name, entity and layer counts and the last commit per file. A file that does not parse is still listed (with zero counts). |
| `history(root, name, limit = 20)` | `Commit[]` newest first: short `sha`, `message`, ISO `at`, `relative`, `author`. Filtered to that one file. |
| `docAt(root, name, sha)` | `git show <sha>:<file>`, parsed. Powers `blueprint_view at:`. |
| `git`, `gitOrThrow` | Thin `Bun.spawnSync` wrappers. Also used by `tui/src/code/`. |

Every write is a commit, so every agent edit is one version. No-op edits do not commit.

## Credentials (`credentials.ts`)

The device token written by `jarvis pair` (`tui/src/cli/pair.ts`).

- `credentialsPath` = `<dataDir>/credentials.json`. Deliberately not in `jarvis.jsonc`, which gets
  committed.
- `writeCredentials` writes with mode 0600 and then `chmod`s, because the umask can mask the mode
  and an existing file keeps its old permissions.
- `readCredentials` returns `undefined` when the file is missing and throws `BlueprintError` when
  it is malformed. `isPaired` never throws (corrupt means not paired). `requireCredentials` throws
  when unpaired.
- Shape: `{ baseUrl, deviceId, token, workstationId, name? }`.

Many other modules read this file (agent remote prompts and approvals, session sync, code sync,
vision, gestures). It lives here because blueprints were the first thing synced.

## Cloud sync (`sync.ts`)

`call(credentials, path, init)` is a `fetch` with `Authorization: Bearer <token>`, JSON content
type and an optional `idempotency-key` header. It returns `{ ok, status, body }` rather than
throwing. `tui/src/code/sync.ts` and `tui/src/pi/items-client.ts` reuse it.

### push

`push(root, name, credentials?)` → `PushOutcome`: `up-to-date`, `pushed` or `merged`.

1. Builds the payload: `{ blueprintId: doc.id, name, commits }`, where `commits` is up to 200
   local commits, oldest first, each `{ sha, parentSha, message, at, doc }` (the first has
   `parentSha: null`).
2. `POST /api/blueprint/push` with idempotency key `<doc.id>:<last sha>`.
3. On 200: `upToDate` → `up-to-date`, else `pushed` with the new server `version` and head.
4. On 409 `diverged`: the server sends `serverHead`, `serverParent`, `serverVersion` and
   `serverDoc`. `mergeWithServer` picks the base: the local commit equal to `serverParent` if
   present, else the oldest local commit. It runs `merge3(base, local, server)`, commits the result
   as `merge <serverHead>[ — N conflict(s)]`, then pushes **only that merge commit**, with
   `parentSha` set to the server's head. That makes it a fast-forward for the server, which never
   had the local chain.
5. Any other status throws `BlueprintError`.

Why the base matters: with too old a base, an entity both sides edited looks like one both sides
*added*, and a real conflict shows up only as a rename.

### pull

`pull(root, name, credentials?)` → `PullOutcome`: `up-to-date`, `fast-forward` or `merged`.

1. `GET /api/blueprint/pull?blueprintId=<doc.id>` (the full history, not `since`; after any
   earlier pull, the local head sha is one the server has never seen).
2. Throws if the server says `truncated` (more than 200 versions).
3. If the latest server doc serializes identically to the local doc: `up-to-date`.
4. If the server's commit list does not contain the local head, there is unpushed local work:
   `merge3(oldest local commit, local, server)` and commit `merge server v<N>`.
5. Otherwise write the server doc and commit `pull server v<N>` (`fast-forward`).

### status

`status(root, name, credentials?)` → `SyncStatus`: paired or not, `baseUrl`, `deviceId`, local head
and commit count, and server head and version (from the same pull endpoint). Network errors are
returned in `error`, not thrown.

## Versions on the web

Each pushed commit becomes one `blueprint_version` row with `commitSha` = the local short sha.
Web-side writes (create, edit, restore, clone, MCP edits) append rows with `commitSha: null`.
Because such a row has no sha a device knows, the next device push does not fast-forward: it gets
a 409 and merges. That is how a web edit and a device edit made at the same time both survive.
The web API accepts either a sha or `v<number>` wherever it takes a version ref.

## Gotchas

- `pull`'s merge path always uses the **oldest** local commit as the base (usually the empty
  `create` commit), unlike `push`, which looks for `serverParent`. So an entity edited on both
  sides is reported as a rename (`e7` → `e7-b`), not as a conflict. Both versions are kept, but the
  user is not warned. The sync tests cover push merges, not pull merges.
- Only the last 200 commits are pushed or pulled (`history(root, name, 200)` and the server's
  `MAX_COMMITS`). `pull` refuses a truncated history instead of guessing.
- `ponytail:` `pull` fetches the whole history every time. Fine for a few hundred small docs;
  switch to `since` plus a stored server version if that grows.
- Deleting a blueprint locally (`blueprint action:"delete"`) is not synced. Deleting it on the web
  does not touch devices.
- Short shas are what the server stores. They are unique enough per blueprint; the server's unique
  index is on `(blueprint_id, commit_sha)`.
