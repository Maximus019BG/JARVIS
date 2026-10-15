---
name: ship
description: Finish a change in JARVIS — sync docs, run the full check/test gate, and make a Conventional Commit on dev (PR into master only if asked). Use when the user says "ship it", "commit this", "wrap up", "we're done", "make a PR", or before claiming a change works.
---

# Ship a change

Rule 7: done means green. Stop at the first failure and report it **verbatim**.

1. `git branch --show-current`. Work happens on `dev`. If you're on `master`, stop and ask.
2. Run `/sync-docs` (rule 10).
3. Gate, from the repo root:
   ```sh
   pnpm check && pnpm test
   ```
   This covers the web lint, the web and tui typecheck, `pnpm rules`, and the web and tui tests. A change in `tui/src/blueprint` or `tui/src/pi` must pass both suites, and this runs both.
4. Run the extra gates that apply to the changed paths:
   - `mobile/` → `cd mobile && bun run typecheck`
   - `web/src/server/db/schemas/` → `SKIP_ENV_VALIDATION=1 pnpm --filter web db:generate` then `git status --porcelain web/drizzle` must be empty after the migration is committed. Use `/db-change`.
   - `tui/src/config/` → `cd tui && bun run schema`; `tui/jarvis.schema.json` must not change, or must be committed.
   - New env var → it's in both `web/src/env.js` and `web/.env.example` (`pnpm rules` checks this).
5. Stage files **by name**. Never `git add -A`, and never stage `.env*`, `*.pem` or `*.key`. Don't stage unrelated changes the user didn't make in this task (e.g. `models/*.ipynb`). Ask about those.
6. Commit with a Conventional Commit subject:
   - `type(scope)!: subject`, where type ∈ `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`
   - the scope is optional and lowercase (`web`, `tui`, `gateway`, `db`, …)
   - the subject is at most 100 characters
   - end with the Co-Authored-By trailer
   - the `.githooks/commit-msg` hook enforces this; never pass `--no-verify`.
7. PR into `master` only if the user asked. Use `gh pr create --base master --head dev`. The PR title is the squash subject, so it must also be a Conventional Commit. Never force-push or `gh pr merge`.
8. Report the commit sha, what the gate ran, and anything skipped.
