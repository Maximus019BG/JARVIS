---
name: db-change
description: Change the Postgres schema in web/ safely — edit the Drizzle schema, generate the migration in the same change, verify it's a no-op on rerun, and update docs (AGENTS.md rule 3). Use when adding/changing a table, column, index, constraint or FK, or when the user says "add a column", "new table", "migration", "db:generate", or CI's "Drizzle migrations match the schema" step fails.
---

# Database schema change

Read `docs/modules/web/database/README.md` first.

1. Edit the table's file in `web/src/server/db/schemas/`. There is one file per table; new tables follow the neighbors' naming and export pattern. The client is `db` from `web/src/server/db/index.ts`.
2. Generate the migration:
   ```sh
   SKIP_ENV_VALIDATION=1 pnpm --filter web db:generate
   ```
   This writes `web/drizzle/NNNN_<name>.sql` and updates `web/drizzle/meta/`. **Never hand-edit `meta/`.** If the generated output is wrong, fix the schema and regenerate.
3. Read the new `.sql` file:
   - Look for `DROP`, a type narrowing, or `NOT NULL` added to an existing column with no default. If any are there, tell the user and plan a way back: backfill first, a two-step migration, or a default.
   - New FKs: is the cascade behaviour intended?
   - Columns used in `WHERE` or join filters need an index.
4. Run the generate command again. `git status --porcelain web/drizzle` must show only the new files, with nothing new on the second run. CI runs the same check.
5. Apply locally only if the user wants it: `pnpm --filter web db:migrate`. Don't use `db:push` on a shared DB.
6. Update the callers. Keep each hot route to as few DB round trips as possible (~230 ms each): one join or a `Promise.all` instead of sequential queries, and never a query in a loop.
7. Docs: update `docs/modules/web/database/` and the module that owns the table (see `/sync-docs`). Bump both `Verified:` lines.
8. Commit the schema, the migration and the docs **together** (`feat(db): …` / `fix(db): …`).
