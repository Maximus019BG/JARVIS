# Runbook: protect `master` on GitHub

Who: the repository owner, never an agent. Body: [`github-ruleset.json`](github-ruleset.json).
When: after each required check has run at least once on a PR (GitHub only offers check names it
has seen).

Local hooks and Claude Code settings are fast feedback, and anyone can skip them. This ruleset is
the only thing that stops an unchecked change from reaching `master`.

## What it enforces
- No direct push, force push or deletion of `master`; changes arrive through a PR.
- The PR merges only when these jobs pass: `Web (lint + typecheck)`, `Web (tests + build)`,
  `Mobile (typecheck)`, `TUI (tests + typecheck)`, `Rules (env, docs, generated files)` and
  `PR title is a Conventional Commit`.
- No required approvals (one maintainer can't approve their own PR). Raise
  `required_approving_review_count` when there is a second reviewer.
- Nobody bypasses.

## Apply
UI: Settings → Rules → Rulesets → New branch ruleset, then copy the settings above.

With the GitHub CLI (`brew install gh && gh auth login`):

```sh
gh api -X POST repos/Maximus019BG/JARVIS/rulesets --input docs/runbooks/github-ruleset.json
```

If a job is renamed, rename its `context` here too, or PRs wait forever on a check that no longer
runs.

## Verify
- `git push origin master` with a new commit is rejected.
- A PR titled `bad title` can't merge.
