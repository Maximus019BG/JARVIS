---
name: decision
description: Record an architectural or design decision as a new D-NN row in docs/decisions.md (AGENTS.md rule 11). Use when the user says "log this decision", "add a decision", "record why we did X", or when a change makes a choice that would surprise a later reader.
---

# Record a decision

1. Read the table in `docs/decisions.md`. The next ID is the highest `D-NN` plus 1, zero-padded.
2. Insert the new row **directly under the header separator**, because the table is newest first:
   ```
   | D-NN | <YYYY-MM-DD> | <what was decided, one sentence> | <why: the constraint or risk that forced it> | <`path`, `path`> |
   ```
   - Keep it to one line. Put file paths in backticks and make sure they exist, because `canon-paths` doesn't check this file but reviewers do.
   - "Why" names the concrete reason (a bug, a cost, a threat), not "cleaner" or "better".
3. **Never edit or delete an old row.** If the new decision replaces one, write `supersedes D-XX` in the Decision cell.
4. Status changes (shipped, dropped, next) go in `docs/ROADMAP.md`, not here.
5. Show the user the row you added.
