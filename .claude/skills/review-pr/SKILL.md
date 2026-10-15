---
name: review-pr
description: Review a JARVIS change the way REVIEW.md prescribes (promises first, 9 passes, Important/Nit findings, pinned verdict line). Use when the user says "review this PR", "review PR #N", "review my branch", "review the diff", or asks for an APPROVE/RETURN verdict.
---

# Review a change per REVIEW.md

**`REVIEW.md` is the spec. Read it now and follow it exactly.** This skill only resolves the target and lists the things people forget. It does not replace the passes.

## Resolve the target
- PR number → `gh pr view <n> --json title,body,baseRefName,headRefOid` and `gh pr diff <n>`.
- Branch → `git diff master...<branch>`, head = `git rev-parse <branch>`.
- Nothing given → `git diff master...HEAD` plus the uncommitted `git diff`.

Review from the diff only. Don't use the author's chat account of what they did.

## Easy to forget
- List the promises (title, description, linked issue) **before** reading the diff.
- Run `pnpm check && pnpm test` and paste the failures verbatim.
- Pass 4: did a change under `tui/src/blueprint` or `tui/src/pi` run both suites?
- Pass 5: is any test deleted, skipped or loosened, or any threshold lowered, without a reason?
- Pass 8: does a new tui tool call `ctx.gate.check` and have a `DEFAULT_RULES` entry, or is it read-only?
- Pass 9: count the DB round trips on hot routes (~230 ms each).
- Findings use the format `file:line — what is wrong — trigger — fix`, under **Important** and **Nit** (at most 5 nits).
- The **last line** is exactly `Verdict: APPROVE @ <head sha>` or `Verdict: RETURN @ <head sha>`.
- After 3 RETURN rounds on the same PR, stop and hand it to a human.

Don't post comments to GitHub unless the user asks.
