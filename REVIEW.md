# REVIEW.md — how a change is reviewed

For human reviewers and for review agents (`/code-review`, a fresh subagent). The reviewer gets
the branch, base and head, and the PR description. It does not get the author's account of what
they did; it reads the diff itself.

## Order

1. List what the PR promises (title, description, linked issue) **before** reading the diff.
2. Read the whole diff.
3. Check each promise against the diff: is it there, is it tested?
4. Run `pnpm check && pnpm test`. Report what failed, verbatim. Don't summarize it.
5. Write findings, most severe first, split into **Important** (must fix) and **Nit** (at most 5).
6. End with exactly one line: `Verdict: APPROVE @ <head sha>` or `Verdict: RETURN @ <head sha>`. The
   sha pins the verdict to what you read; a new push needs a new review. After 3 rounds of RETURN
   on the same PR, stop and hand it to a human.

## Passes

1. **Correctness.** Does it do what it says? Look at edge cases, error paths, async races, and
   off-by-ones in the geometry, tracking and audio code.
2. **Trust boundaries.** Every `/api/*` handler must check auth, device grants and ownership
   (`server/ownership.ts`, `owned-device.ts`, `device-auth.ts`). Input is validated. No secret is
   logged or returned. Rate limits (nginx, `k8s/base/nginx.conf`) stay in place.
3. **Data.** A schema change needs a generated migration in the same PR. A new env var needs both
   `env.js` and `.env.example`. Nothing is destructive without a way back.
4. **Shared code.** A change in `tui/src/blueprint` or `tui/src/pi` breaks `web` too. Both suites
   must have run.
5. **Tests.** New logic with a branch or loop gets one test that fails if the logic breaks. Tests
   that only restate the implementation don't count. **Judge integrity:** no test deleted, skipped
   or weakened, no assertion loosened, no lint rule, threshold or limit lowered to make a change
   pass, unless the PR says why.
6. **Simplicity.** No new dependency for a few lines of code, no abstraction with one user, no
   duplicated helper. Every deliberate shortcut carries a `ponytail:` comment.
7. **Docs.** Every module whose code changed has its `docs/modules/` doc updated in the same PR, with
   a new `Verified:` line, and the doc still matches the code. If behaviour changed, the matching
   `docs/use-cases/` page is updated too. A surprising choice gets a row in
   `docs/decisions.md`, and a status change updates `docs/ROADMAP.md`. The package README is updated
   if commands or setup changed.
8. **Agent safety** (`tui/`). A new tool either calls `ctx.gate.check` and has a `DEFAULT_RULES` entry
   in `tui/src/permission.ts`, or is read-only. No new path carries untrusted text (web pages,
   files, webhook payloads, camera input, repo config) into a prompt or an auto-approved tool
   without the user being asked.
9. **Cost per request** (`web/`). Count the DB round trips a hot route makes; each costs ~230 ms.
   A query inside a loop, or sequential queries that could be one join or one `Promise.all`, is a
   finding.

## Finding format

`file:line — what is wrong — the input or state that triggers it — the fix`. Leave out style nits
that prettier or eslint would catch.
