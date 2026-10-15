---
name: sync-docs
description: Update the docs/modules/ docs for every changed file and bump their Verified line (AGENTS.md rule 10). Use after changing code in tui/ or web/, before committing, when the Stop hook says "Update the module doc and bump its Verified: line", or when the user says "sync docs", "update the docs", "docs-touched is failing".
---

# Sync module docs

Rule 10: code changes and their module doc land in the same commit.

1. List what changed: `git status --porcelain` (worktree) or `git diff --name-only master...HEAD` (branch).
2. Map each file to its doc using the **Index** tables in `docs/modules/README.md`.
   - Web paths in the table are relative to `web/src/` unless they start with `web/`.
   - The longest matching path wins (e.g. `app/api/device/hand/` → Vision, not Devices).
   - Files outside the tables (`models/`, `k8s/`, `.github/`, root config) have no module doc. Say so and skip them.
3. For each affected doc, read the doc and the diff for its files, then fix what is now wrong:
   - the **Files** table (add new files, drop deleted ones; every source file is in exactly one module's table),
   - **How it works**, **Interfaces** (routes, commands, tools, config keys), **Data and state**, **Gotchas**, **Tests**.
   - Edit only what the diff made stale. Don't rewrite sections that are still correct.
4. Bump the header line: `Verified: <YYYY-MM-DD> @ <short sha>`, using today's date and `git rev-parse --short HEAD`.
   Topic files use the same suffix after `Part of [X](README.md). Code: …`.
5. A **new subsystem** gets a folder made from the template at the bottom of `docs/modules/README.md`, plus a row in the Index.
6. If commands, setup or config changed, also update the package README (`tui/README.md`, `web/README.md`, …).
7. A surprising choice gets a row in `docs/decisions.md` (use `/decision`).
8. Verify:
   ```sh
   bun tools/check-rules.ts docs-touched canon-paths
   ```
   Both must pass. `canon-paths` fails on backticked paths that don't exist, so check any path you wrote.

Don't edit docs for a change the user plans to revert. If a change genuinely needs no doc, the commit body gets `Docs-Skip: <reason>`. Ask before using it.
