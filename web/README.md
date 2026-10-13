# web

The JARVIS web app and API: accounts, paired devices, synced sessions and blueprints, the model
gateway, vision inference and automations. Next.js 16 · Drizzle · Postgres · Better Auth.
The overall map is in [`docs/architecture.md`](../docs/architecture.md).

## Run locally

```bash
pnpm install                       # from the repo root (workspace: web + tui)
cp web/.env.example web/.env       # then fill in the values
cd web && ./start-database.sh      # Postgres in Docker/Podman, from DATABASE_URL
pnpm --filter web db:migrate
pnpm dev                           # http://localhost:3000
```

Every variable is validated by `src/env.js`. When you add one, update both `env.js` and
`.env.example`. The gateway (`/api/gateway/*`) stays off and returns 503 until `GATEWAY_ENABLED=true`.

Vision routes need ONNX models that aren't all committed. See [`models/hand/`](models/hand/README.md)
and [`models/items/`](models/items/README.md).

## Scripts

| Script | Does |
|---|---|
| `dev` / `build` / `start` | Next; `dev` and `build` first embed `../tui/install.sh` |
| `check` | eslint + `tsc --noEmit` (what CI runs) |
| `test` | jest, `src/__tests__/**/*.test.ts` |
| `db:generate` | migration from the schema diff, into `drizzle/` |
| `db:migrate` / `db:push` / `db:studio` | apply / push without a migration (dev only) / browse |
| `db:doctor [--fix]` | check (and repair) the drizzle migration ledger against `drizzle/` |
| `db:baseline` | mark existing migrations as applied on a DB that was created without them |
| `format:check` / `format:write` | prettier |

## Layout

```
src/app/(home)         public pages
src/app/(protected)    dashboard: blueprints, code, sessions, automations, usage, settings
src/app/api/           route handlers (device, session, approval, gateway, vision, blueprint, …)
src/server/            server-only logic; db/schemas is the source of truth for the DB
src/components, hooks  UI
drizzle/               generated migrations (never hand-edit meta/)
models/                ONNX models loaded by the vision routes
```

`@blueprint/*` and `@pi/*` resolve to `../tui/src/...`, so a change there runs both test suites.

## Docker

The build context is the repo root, because web imports tui:

```bash
docker build -f web/Dockerfile -t jarvis-web .
docker run --env-file web/.env -p 3000:3000 jarvis-web
```
