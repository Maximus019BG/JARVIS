# AGENTS.md — rules for every agent in JARVIS

Read this first. Details live in [`docs/`](docs/) and each package's README; this file stays short.

## What this repository is

A workstation assistant built in three parts: a terminal coding agent (`tui/`), a web app and API
(`web/`), and a Raspberry Pi 5 with a camera and projector that runs the same `jarvis` binary.
A phone app (`mobile/`) approves and steers sessions remotely. The map and data flow are in
[`docs/architecture.md`](docs/architecture.md). How each subsystem works inside is in
[`docs/modules/`](docs/modules/README.md). Read a module's doc before you change its code.

| Path | What | Stack | Run / test |
|---|---|---|---|
| `tui/` | `jarvis` CLI: agent, blueprints, voice, Pi vision (`jarvis pi`), worker (`jarvis work`) | Bun, TypeScript | `bun run start` · `bun test` · `bun run typecheck` |
| `web/` | Next.js app + `/api/*` (devices, sessions, gateway, vision, automations, blueprints) | Next 16, Drizzle, Postgres, Better Auth | `pnpm --filter web dev` · `pnpm --filter web test` · `pnpm --filter web check` |
| `mobile/` | Expo app: approvals, sessions, talk | Expo 54, React Native | `cd mobile && npm i && npm start` (not in the pnpm workspace) |
| `models/` | Hand-gesture classifier notebook → ONNX ([README](models/README.md)) | Python, `uv` only | `cd models && uv sync` |
| `k8s/` | Kustomize: api, postgres, nginx proxy, network policies; overlays `dev`/`prod`/`test` | Kubernetes | see [`k8s/README.md`](k8s/README.md) |

From the root: `pnpm check` (lint + typecheck everything) and `pnpm test` (web + tui).

## Rules

1. **Never read or print a secret.** No opening `.env`, `.env.local`, `~/.config/jarvis/secrets.json`
   or `*.pem`. Name the variable, never its value. `web/.env.example` is the reference.
2. **New env var → `web/src/env.js` and `web/.env.example` in the same change.** A missing one fails
   boot validation.
3. **DB schema change → migration in the same commit.** Edit `web/src/server/db/schemas/*.ts`, then
   `pnpm --filter web db:generate`. Never hand-edit `web/drizzle/meta/`.
4. **`web` imports `tui` source**: `@blueprint/*` → `tui/src/blueprint`, `@pi/*` → `tui/src/pi`.
   A change there runs **both** test suites (`pnpm test`). TUI imports carry the `.ts` suffix.
5. **Don't hand-edit generated files:** `tui/jarvis.schema.json` (`bun run schema`),
   `web/src/app/install.sh/script.generated.ts` (built from `tui/install.sh`), `models/export/*`
   (the notebook), lockfiles.
6. **Docker builds from the repo root:** `docker build -f web/Dockerfile -t jarvis-web .`
7. **Done means green:** `pnpm check && pnpm test` pass before you say a change works.
8. **Small diffs, reuse first.** Look for an existing helper before writing one. A deliberate shortcut
   with a known limit gets a `ponytail:` comment naming the limit and the upgrade path.
9. **Commits are Conventional Commits** (`feat(scope): …`, `fix: …`), enforced by `.githooks/commit-msg`.
   Work on `dev`, PR into `master`.
10. **Docs follow code.** If you change code, update its module doc in `docs/modules/` **in the same
    commit** and bump that doc's `Verified:` line. `docs/modules/README.md` maps code paths to docs.
    A new subsystem gets a new folder made from the template, plus a row in that index. If commands,
    setup or config change, also update the package README (`tui/`, `web/`, …). A change without
    its doc update isn't done.
11. **Decisions go in [`docs/decisions.md`](docs/decisions.md)**, status in
    [`docs/ROADMAP.md`](docs/ROADMAP.md). Not in chat, not in agent memory.

Reviewing a change? Follow [`REVIEW.md`](REVIEW.md).
