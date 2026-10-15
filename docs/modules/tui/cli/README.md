# CLI

Code: `tui/src/index.tsx`, `tui/src/cli/` (except `cli/voice.ts`), `tui/install.sh`, `tui/docker/` · Verified: 2026-10-14 @ c9135de

## Purpose
The `jarvis` entry point and its non-interactive subcommands: argument parsing and dispatch,
headless runs, the automation worker, `.jarvis` scaffolding, and device pairing (RFC 8628 device
grant). Also how the binary is built and installed, and the Docker image.
Usage: [tui/README.md → Install](../../../../tui/README.md#install),
[Commands](../../../../tui/README.md#commands), [docker/README.md](../../../../tui/docker/README.md).

## How it works

**Dispatch** (`index.tsx` → `main`):
1. `parseArgs` pulls out global flags; everything else lands in `rest`. The first `rest` item is
   the subcommand.
2. `withHostedFallback(loadConfig())` runs once for every subcommand, before anything can call
   the throwing `defaultModelID` (see [agent](../agent/README.md)).
3. Each subcommand dynamic-imports its module, so `jarvis models` does not load the TUI.
4. Errors print `jarvis: <message>` and exit 1.

**Headless run** (`cli/headless.ts` → `runHeadless`): opens or resumes a session
(`openSession`), appends the prompt, loads extensions and MCP in parallel (failures become
warnings), builds a `PermissionGate` with `constantAsker(yes)`, and calls `agent.ts` → `run`.
On a context-overflow error it compacts once and retries. Text goes to stdout; tool traces,
errors and the token/cost line go to stderr. Returns the `RunResult` for in-process callers.
No `ask` callback is passed, so the `ask` and `find_item` tools are absent.

**Worker** (`cli/work.ts` → `work`): the web app cannot reach a NATed machine, so this polls.
Loop: `POST /api/device/automation/claim`; on a job, resolve `job.cwd` under `--root` and refuse
anything outside (`within`, from `config/discover.ts`); run `runHeadless` with `yes: options.yes`
(default `false`, set by `-y`) and `AbortSignal.timeout(job.timeoutSec * 1000)`; post the outcome
to `/api/device/automation/result`. Poll every 3 s, dropping to 15 s after 2 minutes idle. Without
`-y`, a tool call the config's `permission` rules would `ask` about is refused (D-11): a job's
prompt can carry a webhook payload, which anyone holding the webhook URL wrote. The device API
calls time out after 30 s.

**Trust** (`index.tsx`, `trust` case → `config/discover.ts` → `trust`): adds the repo root to
`~/.config/jarvis/trusted.json`, or the current directory outside a repo, or the given path.
`--list` prints the list. Until then a repo's `jarvis.jsonc` and `.jarvis/` are ignored, and
`run`, `config` and the TUI say so in one line (`trustNotice`).

**Pairing** (`cli/pair-flow.ts`, shared with the `/pair` wizard in the UI):
1. `requestCode` → `POST /api/device/code` with `{name, fingerprint, platform, email?}`.
   `fingerprint` is a sha256 of `/etc/machine-id` (or hostname) + hostname, first 12 hex chars.
2. `pollForToken` → `POST /api/device/token` with `{deviceCode}` every `interval` seconds:
   `authorization_pending` continues, `slow_down` adds 5 s, anything else is terminal. Each
   request times out after 30 s.
3. `cli/pair.ts` → `pair` writes the result with `writeCredentials` (mode 600). Base URL order:
   argument, `JARVIS_CLOUD_URL`, `config.cloud`, then an interactive prompt.
`unpair` only deletes the local file; the token stays valid until revoked in the web app.

**Scaffold** (`cli/init.ts` → `init`): writes example files into `.jarvis/` without overwriting.
`index.tsx` then calls `code/project.ts` → `initProject` so the directory is a code project.

**Install** (`install.sh`): needs `bun` (offers to run the official installer), clones the repo
when piped from a deployment (`JARVIS_REPO` overrides the URL), `bun install --frozen-lockfile`,
`bun build --compile` on the host (bun embeds the host's `libopentui`), installs to `--prefix`.
Seeds `~/.config/jarvis/jarvis.jsonc` from `tui/jarvis.jsonc` only when no config exists (adding
`"cloud"` when `--cloud`/`JARVIS_CLOUD_URL` is set), copies `assets/global/agents/*.md` when
absent and `assets/global/skills/*` file by file with `cp -Rn`. `--service` installs
`assets/pi/jarvis-work.service` as `jarvis-work@.service` (enabled, not started); `--pi` installs
the projector units.

**Docker** (`docker/Dockerfile`): two stages (deps, final) on `oven/bun`, adds `git`, `ripgrep`,
`ca-certificates`; runs from source (`bun run /app/src/index.tsx`) because provider packages are
installed at runtime. `docker/compose.yaml` mounts the workspace at `/workspace`, the host config
at `/config/jarvis`, and a `jarvis-data` volume at `/data`.

## Files
| File | Responsibility |
|---|---|
| `tui/src/index.tsx` | Entry point: `HELP`, `VERSION`, `parseArgs`, subcommand dispatch |
| `tui/src/cli/headless.ts` | `runHeadless`: one prompt without the TUI |
| `tui/src/cli/work.ts` | `work`: automation job worker |
| `tui/src/cli/init.ts` | `init`: scaffold `.jarvis/` examples |
| `tui/src/cli/pair-flow.ts` | Device grant protocol: `requestCode`, `pollForToken`, `pairArgs`, `fingerprint`, `platformLabel`, `defaultDeviceName`, `normaliseBaseUrl`, `PairCancelled` |
| `tui/src/cli/pair.ts` | `pair`, `unpair`, `showDevice` (printing front end) |
| `tui/install.sh` | Build, install, seed config/agents/skills, optional systemd units, uninstall |
| `tui/docker/Dockerfile` | Container image |
| `tui/docker/compose.yaml` | Compose service with workspace/config/data mounts |
| `tui/docker/README.md` | Docker usage |

`tui/src/cli/voice.ts` belongs to [voice](../voice/README.md).

## Interfaces

**Subcommands** (`index.tsx`):

| Command | Does | Handled in |
|---|---|---|
| `jarvis` | Interactive TUI | `ui/start.tsx` → `startTui` |
| `jarvis run <prompt…>` | Headless turn | `cli/headless.ts` |
| `jarvis work [--root <dir>] [-y]` | Automation worker; `-y` approves every tool call | `cli/work.ts` |
| `jarvis trust [dir\|--list]` | Let a repo's `jarvis.jsonc` and `.jarvis/` load | `config/discover.ts` |
| `jarvis init` | Scaffold `.jarvis/` + code project | `cli/init.ts`, `code/project.ts` |
| `jarvis models` | List models, `*` marks the active one | `agent/provider.ts` |
| `jarvis config` | Config files, agents, commands, tools, skills, plugins, themes | `index.tsx` |
| `jarvis pair [email] [url]` | Pair; args read by shape (`@` = email, `http…` = URL) | `cli/pair.ts` |
| `jarvis unpair [-y]` | Forget local credentials | `cli/pair.ts` |
| `jarvis device` | Show pairing | `cli/pair.ts` |
| `jarvis wake models [phrase]` | Download wake-word models | `voice/wake-models.ts` |
| `jarvis voice …` | Speaker models/enrolment | `cli/voice.ts` |
| `jarvis pi [blueprint\|calibrate\|models]` | Hand drawing on a projector; `--source`, `--replay`, `--port`, `--width`, `--height`, `--fps` | `pi/index.ts` |

**Global flags**: `-m/--model`, `-a/--agent`, `-s/--session`, `-c/--continue`, `-y/--yes`,
`-h/--help`, `-v/--version`.

**`.jarvis/` files created by `init`**: `package.json`, `tsconfig.json`, `.gitignore`,
`agents/example.md`, `commands/example.md`, `skills/example/SKILL.md`, `tools/example.ts`,
`plugins/example.ts`. The example plugin auto-allows `git status|diff|log` but not a chained
command, the same rule `permission.ts` → `prefixMatches` applies to config prefixes.

**install.sh flags**: `--prefix <dir>`, `--pi`, `--service [dir]`, `--cloud <url>`, `-y/--yes`,
`--uninstall`, `-h/--help`.

**Web API endpoints called**:

| Method · path | Auth | Body → response |
|---|---|---|
| `POST /api/device/code` | none | `{name, fingerprint, platform, email?}` → `{userCode, deviceCode, verificationUri, verificationUriComplete, qr?, expiresIn, interval}` |
| `POST /api/device/token` | none | `{deviceCode}` → `{deviceId, token, workstationId, name}` or `{error}` |
| `POST /api/device/automation/claim` | Bearer device token | — → `{job?: {id, prompt, cwd, model, timeoutSec}}` |
| `POST /api/device/automation/result` | Bearer device token | `{jobId, ok, text?, error?, usage?}` |

## Data and state
- Credentials: `~/.local/share/jarvis/credentials.json` (written by `pair`, removed by `unpair`).
- Install: binary at `$PREFIX/jarvis` (default `~/.local/bin`), config in
  `${XDG_CONFIG_HOME:-~/.config}/jarvis/`, global agents in `…/agents/`, skills in `…/skills/`.
- Env: `JARVIS_CLOUD_URL` (pair base URL; also seeds install), `JARVIS_PREFIX`, `JARVIS_REPO`,
  `BUN_INSTALL` (install.sh); `XDG_CONFIG_HOME=/config`, `XDG_DATA_HOME=/data` in Docker;
  compose passes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VELOCITY_API_KEY`, `GEMINI_API_KEY`.

## Depends on / used by
- Depends on: [agent](../agent/README.md) (`run`, sessions, compaction, hosted fallback),
  [config](../config/README.md), [extensions](../extensions/README.md) (`loadExtensions`,
  `startMcp`, `loadCommands`), [tools](../tools/README.md) (`PermissionGate`, `constantAsker`),
  `blueprint/credentials.ts`, `code/project.ts`, and the voice/pi/UI entry points it dispatches to.
- Used by: `ui/app.tsx` (imports `cli/pair-flow.ts` for the `/pair` wizard), the systemd worker
  unit, the web app's served `install.sh`.

## Gotchas
- `jarvis work` refuses "ask" tool calls unless started with `-y`. `--root` (default cwd) bounds
  where jobs run; jobs whose `cwd` resolves outside it are refused and reported as failed. The
  systemd unit (`assets/pi/jarvis-work.service`) runs without `-y`, so a job that needs bash or
  edits needs `permission` rules in the config, or `-y` added to its `ExecStart`.
- Trust is not required to run `jarvis work`: an untrusted root only means its `.jarvis/` code
  doesn't load, which is the safe side.
- `VERSION` is hardcoded in `index.tsx`; a compiled binary has no `package.json` to read.
- `jarvis models` prints "add a `provider` entry" when nothing is configured, while
  `defaultModelID` points at ctrl+y or `jarvis pair`.
- `install.sh`'s header advertises `--uninstall --purge` and `./uninstall.sh`, but neither
  exists: `--purge` fails as an unknown option and there is no `uninstall.sh` in `tui/`.
- `install.sh` seeds the repo's own `jarvis.jsonc`, which includes a `check` running
  `bunx tsc --noEmit` after every `.ts` write in any project. Remove it from the global config if
  unwanted.
- The Docker image does not copy `assets/global`, so global agents and skills only exist in a
  container if the mounted `~/.config/jarvis` already has them. `JARVIS_IN_DOCKER=1` is set but
  nothing in `src/` reads it.
- `pair` refuses when already paired; run `unpair -y` first.

## Tests
Run from `tui/`: `bun test`.

| Test | Covers |
|---|---|
| `tui/test/config.test.ts` | `parseArgs` |
| `tui/test/headless.test.ts` | `runHeadless` with sessions |
| `tui/test/work.test.ts` | `work`, `within`, root refusal |
| `tui/test/discover.test.ts` | `trust`, `trustNotice` |
| `tui/test/pair-flow.test.ts` | `requestCode`, `pollForToken` |
| `tui/test/pair.test.ts` | `pair`, `unpair`, `pairArgs`, credentials file |
| `tui/test/pair-setup.test.ts` | UI pairing setup over `pair-flow.ts` |
| `tui/test/extensions.test.ts` | `init` output loads as working extensions |
