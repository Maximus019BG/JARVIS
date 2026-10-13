# Module docs

How each subsystem works on the inside: the flows, which file does what, contracts, state and
gotchas. **Usage** (install, commands, config) is covered in the package READMEs ([`tui/`](../../tui/README.md),
[`web/`](../../web/README.md), [`mobile/`](../../mobile/README.md), [`models/`](../../models/README.md),
[`k8s/`](../../k8s/README.md)). Module docs link to them instead of copying them.

## Rule: docs follow code

When you change code under a path in the table below, update that module's doc **in the same
commit** and bump its `Verified:` line. When you add a subsystem, give it a folder made from the
template at the bottom of this page, and add a row here. Every source file appears in exactly one
module's **Files** table.

## Index

### tui

| Module | Code | Doc |
|---|---|---|
| Agent | `tui/src/agent/` | [tui/agent](tui/agent/README.md) |
| Blueprint system | `tui/src/blueprint/` | [tui/blueprint-system](tui/blueprint-system/README.md) |
| Tools | `tui/src/tools/`, `tui/src/permission.ts` | [tui/tools](tui/tools/README.md) |
| UI | `tui/src/ui/` (except voice/speak files) | [tui/ui](tui/ui/README.md) |
| Pi vision | `tui/src/pi/`, `tui/assets/pi/` | [tui/pi-vision](tui/pi-vision/README.md) |
| Voice | `tui/src/voice/`, `tui/src/ui/{voice,speak,speak-command,sound}.ts`, `tui/src/cli/voice.ts` | [tui/voice](tui/voice/README.md) |
| Config | `tui/src/config/`, `tui/scripts/emit-schema.ts`, `tui/jarvis.jsonc` | [tui/config](tui/config/README.md) |
| Extensions | `tui/src/extend/`, `tui/assets/global/` | [tui/extensions](tui/extensions/README.md) |
| CLI | `tui/src/index.tsx`, `tui/src/cli/` (except voice), `tui/install.sh`, `tui/docker/`, `tui/.dockerignore` | [tui/cli](tui/cli/README.md) |
| Code projects | `tui/src/code/` | [tui/code-projects](tui/code-projects/README.md) |
| Engineering | `tui/src/engineering/` | [tui/engineering](tui/engineering/README.md) |

### web

| Module | Code | Doc |
|---|---|---|
| Auth and accounts | `app/api/auth/`, `lib/auth*.ts`, `lib/validation/auth/`, `lib/permissions.ts`, `app/auth/`, `components/{auth,account,user}/`, `app/(protected)/app/settings/` | [web/auth-and-accounts](web/auth-and-accounts/README.md) |
| Devices and pairing | `app/api/{device,workstation}/` (except blueprint/automation/hand subroutes; `device/code` is pairing step 1), `server/{device-auth,owned-device,ownership}.ts`, `components/{devices,workstation}/`, `app/(protected)/link/`, `lib/validation/workstations.ts`, `lib/workstation-hooks.ts` | [web/devices-and-pairing](web/devices-and-pairing/README.md) |
| Sessions and approvals | `app/api/{session,approval,mobile}/`, `app/api/device/prompt/`, `server/steering.ts`, `server/db/queries/session.ts`, `components/{sessions,approvals}/`, `app/(protected)/app/sessions/`, `lib/{transcript-lines,notifications,session}.ts`, `lib/validation/mobile/` | [web/sessions-and-approvals](web/sessions-and-approvals/README.md) |
| Gateway | `server/gateway/`, `app/api/gateway/`, `app/(protected)/app/usage/`, `lib/usage.ts` | [web/gateway](web/gateway/README.md) |
| Vision | `server/{vision,hand}*`, `app/api/vision/`, `app/api/device/hand/`, `web/models/` | [web/vision](web/vision/README.md) |
| Blueprints | `app/api/blueprint/`, `app/api/workstation/blueprint/`, `server/blueprint-*.ts`, `components/blueprints/`, `app/(protected)/app/blueprints/`, `lib/api/blueprint*.ts`, `lib/{blueprint-name,workstation-blueprints}.ts` | [web/blueprints](web/blueprints/README.md) |
| Automations | `server/automations/`, `app/api/automations/`, `app/api/{device,workstation}/automation/`, `components/automations/`, `lib/automations/`, `lib/api/automations.ts`, `app/(protected)/app/automations/` | [web/automations](web/automations/README.md) |
| MCP | `server/mcp/`, `app/api/mcp/`, `app/api/device/mcp-token/` | [web/mcp](web/mcp/README.md) |
| Code projects | `app/api/code/`, `app/(protected)/app/code/` | [web/code-projects](web/code-projects/README.md) |
| Database | `server/db/` (schemas, index), `drizzle/`, `drizzle.config.ts`, `scripts/db-*.mjs`, `start-database.sh` | [web/database](web/database/README.md) |
| Email | `server/email/`, `emails/`, `lib/email.ts` | [web/email](web/email/README.md) |
| Frontend shell | `app/{layout,global-error,opengraph-image,robots,sitemap}.tsx?`, `app/(home)/`, `app/(protected)/{layout,app/layout,app/page}.tsx`, `app/install.sh/`, `components/{landing,dashboard,common,providers,animate-ui,ui}/`, `components/*.tsx`, `config/`, `hooks/`, `lib/{utils,format,copy,image,ip-location,sheet-store,type-to-confirm-store}.ts`, `lib/api/error.ts`, `proxy.ts`, `env.js`, `styles/`, `scripts/embed-install-sh.mjs` | [web/frontend-shell](web/frontend-shell/README.md) |

Web paths are relative to `web/src/` unless they start with `web/`.

### Other

| Module | Doc |
|---|---|
| Mobile | [mobile](mobile/README.md) |
| Gesture model training | [`models/README.md`](../../models/README.md) |
| Kubernetes | [`k8s/README.md`](../../k8s/README.md) |

## Template

Every module folder has a `README.md` in this shape. A module too big for one page adds topic
files next to it, linked from its README.

```markdown
# <Module>

Code: `<paths>` · Verified: <YYYY-MM-DD> @ <short sha>

## Purpose
What it does and for whom, in 2–4 lines.

## How it works
The main flows, step by step, citing `file.ts` → `symbol`.

## Files
| File | Responsibility |
|---|---|

## Interfaces
Commands, API routes (method · auth · body · response), agent tools, and config keys it exposes.

## Data and state
DB tables, files on disk, env vars, in-memory caches.

## Depends on / used by

## Gotchas
Non-obvious rules, limits, and `ponytail:` shortcuts.

## Tests
Which test files cover it and how to run them.
```
