# Database

Code: `web/src/server/db/` (schemas, `index.ts`), `web/drizzle/`, `web/drizzle.config.ts`, `web/scripts/db-doctor-drizzle.mjs`, `web/scripts/db-baseline-drizzle.mjs`, `web/start-database.sh` · Verified: 2026-10-13 @ c292f2f

## Purpose
Postgres access for the whole web app: one Drizzle client, one schema file per table group,
and the drizzle-kit migration history. This module owns the plumbing, not the tables. Each
table belongs to the feature module listed below. Usage commands are in [`web/README.md`](../../../../web/README.md).

## How it works
- **Client.** `web/src/server/db/index.ts` → `db` is `drizzle(postgres(DATABASE_URL), { schema })`.
  `schema` spreads every schema module into one flat map. Two consumers need it: Drizzle's
  relational query API, and better-auth's `drizzleAdapter` in `web/src/lib/auth.ts`, which
  finds its `user`/`session`/`account`/`verification`/`two_factor` tables by export name.
  Outside production the `postgres` connection is cached on `globalThis`, so Next dev hot reloads
  do not open a new pool each time.
- **Schema → SQL.** `web/drizzle.config.ts` points drizzle-kit at `./src/server/db/schemas/*.ts`
  (dialect `postgresql`, URL from `env.DATABASE_URL`). A new table needs **both** a schema file
  that drizzle-kit picks up via the glob **and** an import in `index.ts`. Without the import, the
  migration creates the table but `db`/better-auth will not see it in `schema`.
- **Migrations.**
  1. Change a schema file.
  2. `pnpm --filter web db:generate` (`drizzle-kit generate`) diffs the schemas against the
     newest snapshot in `web/drizzle/meta/` and writes a new numbered `.sql` file in
     `web/drizzle/`, a new snapshot, and an entry in `web/drizzle/meta/_journal.json`.
  3. `pnpm --filter web db:migrate` (`drizzle-kit migrate`) applies, in journal order, every
     entry whose `when` timestamp is newer than the latest row in
     `drizzle.__drizzle_migrations` (the ledger stores `hash` = sha256 of the SQL file, and `created_at` = the journal's `when`).
  - `db:push` (sync the schema without migration files) and `db:studio` also exist. Do not use
    `db:push` against a database that `db:migrate` manages: the ledger will not know about it.
- **Why `meta/` must not be hand-edited.** The snapshots are drizzle-kit's only memory of what
  the database looks like. A hand-written migration with no snapshot makes the next `generate`
  re-emit the same DDL. This has already happened: `web/drizzle/0006_blueprint_versioning.sql`
  was written by hand with no 0006 snapshot, so `web/drizzle/0007_blueprint_device_pairing.sql`
  re-created `blueprint_version` and had to be patched to `CREATE TABLE IF NOT EXISTS` (its
  header explains this). `web/drizzle/0004_script_sync.sql` also has no snapshot, and the next
  migration, `web/drizzle/0005_previous_nomad.sql`, duplicated its `CREATE TABLE`. It is now a
  `SELECT 1` no-op. The rule: let `generate` write SQL,
  snapshot and journal together. If you need custom SQL (backfills, `IF NOT EXISTS`), edit the
  generated `.sql` file, or create an empty migration with `drizzle-kit generate --custom`.
  Never touch `meta/`. Once a migration is applied anywhere, do not edit its `.sql`
  either: the hash changes, and `db:doctor` will report it as missing.
- **`db:doctor`** (`web/scripts/db-doctor-drizzle.mjs`) reads `DATABASE_URL` from the
  environment or `web/.env`. It hashes every journal entry's SQL file and lists entries whose
  hash **and** `when` are both absent from `drizzle.__drizzle_migrations`. It exits 1 if any are
  missing. With `pnpm --filter web db:doctor -- --fix` it inserts ledger rows for them
  (`baselineMissing`), without running their SQL. Use it when a database was built by `db:push`
  or by hand, so its tables exist but `db:migrate` would try to create them again.
- **`db:baseline`** (`web/scripts/db-baseline-drizzle.mjs`) does the `--fix` step
  unconditionally: it marks **every** journal entry as applied (skipping ones already in the
  ledger, by hash or `when`). It is for adopting an existing database. On a database that is
  really missing tables it hides that fact, so run `db:doctor` first.
- **`web/start-database.sh`** starts a local Postgres in Docker or Podman. It sources `web/.env`,
  parses the password, port and db name out of `DATABASE_URL`, and refuses if the port is
  taken. It reuses a container named `<db>-postgres` if one exists. If the password is still the
  literal `password`, it offers to generate one and writes it back into `.env` with `sed -i ''`
  (BSD/macOS syntax).

## Files
#### Client, config, scripts
| File | Responsibility |
|---|---|
| `web/src/server/db/index.ts` | `db` client, `schema` map, dev connection cache |
| `web/drizzle.config.ts` | drizzle-kit config: schema glob, dialect, `DATABASE_URL` |
| `web/scripts/db-doctor-drizzle.mjs` | `db:doctor`: report ledger rows missing for journal entries, and insert them with `--fix` |
| `web/scripts/db-baseline-drizzle.mjs` | `db:baseline`: mark every journal entry as applied |
| `web/start-database.sh` | Local Postgres container from `web/.env` |

`web/src/server/db/queries/session.ts` is under `server/db/` but belongs to
[web/sessions-and-approvals](../sessions-and-approvals/README.md).

#### Schema files (schema file → table → owning module)
| File | Table(s) | Owning module |
|---|---|---|
| `web/src/server/db/schemas/user.ts` | `user` | [auth-and-accounts](../auth-and-accounts/README.md) |
| `web/src/server/db/schemas/session.ts` | `session` (better-auth sessions, plus the mobile Expo push token) | [auth-and-accounts](../auth-and-accounts/README.md) |
| `web/src/server/db/schemas/account.ts` | `account` | [auth-and-accounts](../auth-and-accounts/README.md) |
| `web/src/server/db/schemas/verification.ts` | `verification` | [auth-and-accounts](../auth-and-accounts/README.md) |
| `web/src/server/db/schemas/two-factor.ts` | `two_factor` | [auth-and-accounts](../auth-and-accounts/README.md) |
| `web/src/server/db/schemas/workstation.ts` | `workstation` | [devices-and-pairing](../devices-and-pairing/README.md) |
| `web/src/server/db/schemas/device.ts` | `device` | [devices-and-pairing](../devices-and-pairing/README.md) |
| `web/src/server/db/schemas/device_link.ts` | `device_link` | [devices-and-pairing](../devices-and-pairing/README.md) |
| `web/src/server/db/schemas/device_grant.ts` | `device_grant` | [devices-and-pairing](../devices-and-pairing/README.md) |
| `web/src/server/db/schemas/agent_session.ts` | `agent_session` | [sessions-and-approvals](../sessions-and-approvals/README.md) |
| `web/src/server/db/schemas/session_prompt.ts` | `session_prompt` | [sessions-and-approvals](../sessions-and-approvals/README.md) |
| `web/src/server/db/schemas/approval.ts` | `approval` | [sessions-and-approvals](../sessions-and-approvals/README.md) |
| `web/src/server/db/schemas/gateway_usage.ts` | `gateway_usage` | [gateway](../gateway/README.md) |
| `web/src/server/db/schemas/vision_item.ts` | `vision_item` | [vision](../vision/README.md) |
| `web/src/server/db/schemas/blueprint.ts` | `blueprint` | [blueprints](../blueprints/README.md) |
| `web/src/server/db/schemas/blueprint_version.ts` | `blueprint_version` | [blueprints](../blueprints/README.md) |
| `web/src/server/db/schemas/sync_log.ts` | `sync_log` | [blueprints](../blueprints/README.md); also written by code push and session push, and counted for push rate limits |
| `web/src/server/db/schemas/idempotency_key.ts` | `idempotency_key` | [blueprints](../blueprints/README.md); also used by code push |
| `web/src/server/db/schemas/automation.ts` | `automation` | [automations](../automations/README.md) |
| `web/src/server/db/schemas/automation-version.ts` | `automation_version` | [automations](../automations/README.md) |
| `web/src/server/db/schemas/automation-trigger.ts` | `automation_trigger` | [automations](../automations/README.md) |
| `web/src/server/db/schemas/automation-run.ts` | `automation_run` | [automations](../automations/README.md) |
| `web/src/server/db/schemas/automation-run-step.ts` | `automation_run_step` | [automations](../automations/README.md) |
| `web/src/server/db/schemas/automation-job.ts` | `automation_job` | [automations](../automations/README.md) |
| `web/src/server/db/schemas/code_project.ts` | `code_project`, `code_version` | [code-projects](../code-projects/README.md) |
| `web/src/server/db/schemas/script_file.ts` | `script_file` | none: no code reads or writes it |
| `web/src/server/db/schemas/nonce.ts` | `nonce` | none: no code reads or writes it |

#### Migrations (`web/drizzle/`, applied in `meta/_journal.json` order)
| File | What it does |
|---|---|
| `web/drizzle/0000_medical_meteorite.sql` | `user`, `session`, `account`, `verification`, `two_factor`, `workstation` |
| `web/drizzle/0001_loose_psylocke.sql` | `blueprint` |
| `web/drizzle/0002_lean_richard_fisk.sql` | drops `workstation.slug` |
| `web/drizzle/0003_lush_nightmare.sql` | the six `automation*` tables; `device`, `sync_log`, `nonce`, `idempotency_key`; blueprint sync columns |
| `web/drizzle/0003_blueprint_sync.sql` | **Not in the journal, never runs.** An earlier variant of the device/sync tables that `0003_lush_nightmare.sql` superseded |
| `web/drizzle/0004_script_sync.sql` | `script_file` (hand-written, no snapshot) |
| `web/drizzle/0005_previous_nomad.sql` | no-op `SELECT 1`. Was a duplicate of 0004, kept so existing ledgers stay valid |
| `web/drizzle/0006_blueprint_versioning.sql` | `blueprint_version` (hand-written, no snapshot) |
| `web/drizzle/0007_blueprint_device_pairing.sql` | `device_link`, `device_grant`, device pairing columns; `blueprint_version` re-created with `IF NOT EXISTS` (see its header) |
| `web/drizzle/0008_sleepy_mac_gargan.sql` | `approval` |
| `web/drizzle/0009_fat_deathstrike.sql` | `agent_session` |
| `web/drizzle/0010_amazing_serpent_society.sql` | `session_prompt` |
| `web/drizzle/0011_blue_gamora.sql` | `automation_trigger.last_fired_at` and the `(workstation_id, type)` index |
| `web/drizzle/0012_majestic_agent_brand.sql` | `gateway_usage` |
| `web/drizzle/0013_useful_catseye.sql` | `device.scopes` |
| `web/drizzle/0014_outstanding_drax.sql` | `device_link.target_user_id` |
| `web/drizzle/0015_code_projects.sql` | `code_project`, `code_version` |
| `web/drizzle/0016_vision_items.sql` | `vision_item` |
| `web/drizzle/0017_vision_scope_backfill.sql` | data-only: adds `vision:*` scopes to already approved devices |
| `web/drizzle/meta/_journal.json` | Ordered list of migrations (tag, `when`) that drizzle-kit and both scripts read |
| `web/drizzle/meta/0000_snapshot.json`, `web/drizzle/meta/0001_snapshot.json`, `web/drizzle/meta/0002_snapshot.json`, `web/drizzle/meta/0003_snapshot.json`, `web/drizzle/meta/0005_snapshot.json`, `web/drizzle/meta/0007_snapshot.json`, `web/drizzle/meta/0008_snapshot.json`, `web/drizzle/meta/0009_snapshot.json`, `web/drizzle/meta/0010_snapshot.json`, `web/drizzle/meta/0011_snapshot.json`, `web/drizzle/meta/0012_snapshot.json`, `web/drizzle/meta/0013_snapshot.json`, `web/drizzle/meta/0014_snapshot.json`, `web/drizzle/meta/0015_snapshot.json`, `web/drizzle/meta/0016_snapshot.json`, `web/drizzle/meta/0017_snapshot.json` | drizzle-kit's schema snapshot after each migration (there are none for 0004 and 0006). Generated, never hand-edited |

## Interfaces
`package.json` scripts (run as `pnpm --filter web <script>`):

| Script | Runs |
|---|---|
| `db:generate` | `drizzle-kit generate` |
| `db:migrate` | `drizzle-kit migrate` |
| `db:push` | `drizzle-kit push` |
| `db:studio` | `drizzle-kit studio` |
| `db:doctor` | `node ./scripts/db-doctor-drizzle.mjs` (`-- --fix` to repair) |
| `db:baseline` | `node ./scripts/db-baseline-drizzle.mjs` |

Exports: `web/src/server/db/index.ts` → `db`, `schema`. No API routes.

## Data and state
- Env: `DATABASE_URL` (validated in `web/src/env.js`; the two scripts read it from the
  environment or parse `web/.env` themselves). `NODE_ENV` controls the dev connection cache.
- Ledger: `drizzle.__drizzle_migrations (id, hash, created_at)`.
- In memory: one `postgres` pool per process (`globalForDb.conn` in dev).

## Depends on / used by
- Depends on: `web/src/env.js` ([web/frontend-shell](../frontend-shell/README.md)), `drizzle-orm`, `drizzle-kit`, `postgres`.
- Used by: every server module; better-auth via `web/src/lib/auth.ts`.

## Gotchas
- **Count queries, not rows.** Production Postgres is Neon us-east-1, roughly 230 ms per round
  trip (see the comments in `web/src/lib/auth.ts` and `web/src/lib/session.ts`). Batch,
  join, or cache rather than looping queries.
- No Drizzle `relations()` are defined. better-auth's `experimental.joins` must stay off, or it
  throws (comment in `web/src/lib/auth.ts`).
- `db:doctor` and `db:baseline` connect with `ssl: "require"`, so they fail against the plain
  local container from `start-database.sh`. They are for the hosted database.
- The doctor treats a matching `when` as applied even when the hash differs, so it will not
  catch an edited migration whose timestamp is unchanged.
- Migration filenames are not unique by number: `0003_blueprint_sync.sql` and
  `0003_lush_nightmare.sql` both exist. The journal decides which one runs.
- Comments in `automation-run.ts` and `automation-version.ts` say migrations are deferred. That
  is stale: those tables are in `0003_lush_nightmare.sql`.
- `start-database.sh`'s `sed -i ''` only works with BSD sed (macOS). On Linux or WSL the
  password rewrite fails.

## Tests
No tests cover this module directly. `pnpm --filter web test` runs the suites that touch
tables through their feature modules, and `pnpm --filter web db:doctor` is the check for
ledger drift.
