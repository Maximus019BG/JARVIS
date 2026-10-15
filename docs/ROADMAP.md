# Roadmap

Status and open items only, with no narratives. One row per track. Keep each Status cell short and
dated. Decisions go to [`decisions.md`](decisions.md), bugs to GitHub Issues.

## Tracks

| Track | Status | Next |
|---|---|---|
| TUI agent (`tui/`) | working — 904 tests green (2026-10-13) | — |
| Blueprints (tui + web editor) | working, versioned, synced (2026-10-09) | — |
| Vision: gestures + items | gestures and `/learn` `/find` working (2026-10-09) | — |
| Voice (dictate, wake word, speak) | working (2026-09-24) | — |
| Web app + API | working — 165 tests green (2026-10-13) | `/api/health` route → switch k8s probes from TCP to `httpGet` |
| Automations | canvas, runner, triggers, schedule, `jarvis work` worker exist (2026-10-13) | check against [`automations-rewrite-plan.md`](automations-rewrite-plan.md) |
| Mobile | approvals, sessions, talk screens exist; typecheck in CI (2026-10-14) | no tests |
| Pi hardware (projector, kiosk) | systemd units in `tui/assets/pi/` | — |
| Deploy (k8s) | base + dev/test/prod overlays, TLS, network policies (2026-10-09) | pin the prod image tag on release |

## Known gaps

| Gap | Since |
|---|---|
| `master` has no GitHub ruleset yet, so required checks aren't enforced ([runbook](runbooks/github-ruleset.md)) | 2026-10-14 |
| Extra lockfiles: `tui/pnpm-lock.yaml`, `web/pnpm-lock.yaml` next to the root one | 2026-10-13 |
