# Install and setup

Modules: [tui/cli](../modules/tui/cli/README.md), [tui/config](../modules/tui/config/README.md), [tui/extensions](../modules/tui/extensions/README.md), [tui/engineering](../modules/tui/engineering/README.md), [web/frontend-shell](../modules/web/frontend-shell/README.md), [web/database](../modules/web/database/README.md), [`k8s/`](../../k8s/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why

Two people do this. An **operator** deploys the web app (API, database, proxy) that devices pair with.
A **user** installs the `jarvis` binary on a laptop, a server or a Raspberry Pi, pairs it, and picks a
model. After that, the same binary runs the TUI, headless jobs, the automation worker, or the Pi's
drawing daemon.

## Flow

### Deploy the web side (operator)

1. **Build the image from the repo root**: `docker build -f web/Dockerfile -t jarvis-web .`. The root is
   needed because `web/` imports `tui/src/blueprint` and `tui/src/pi`, and the build embeds
   `tui/install.sh` (AGENTS.md rule 6). The image builds with `SKIP_ENV_VALIDATION=1` and placeholder
   secrets. Real values arrive at runtime.
2. **Provide env.** Every variable is declared in `web/src/env.js` and listed in `web/.env.example`. A
   missing or invalid one fails boot. On Kubernetes they come from the `web-env` secret, and
   `DATABASE_URL` must point at the `db-server` host. Postgres gets its own `db-env` secret.
3. **Apply the manifests**: `k8s/tls.sh <ns>` for the certificate, then `kubectl apply -k k8s/overlays/dev`
   (or `k8s/overlays/prod`, or `k8s/test`). The base runs the API as `jarvis-web`, nginx with TLS in
   front of it, Postgres 15 as a StatefulSet with a 5 Gi volume, and default-deny network policies.
4. **Migrate the database.** Nothing in the image or the manifests runs migrations. From a checkout,
   point `DATABASE_URL` at the target database and run `pnpm --filter web db:migrate`. It applies every
   journal entry newer than the last row in `drizzle.__drizzle_migrations`. For a database built without
   migrations, run `pnpm --filter web db:doctor` first, then `-- --fix` or `db:baseline` to mark existing
   tables as applied.
5. **Probes decide traffic.** Readiness is `GET /api/ready`. It runs `select 1` and answers 503
   "database unreachable" when Postgres is down, so the pod leaves rotation. Liveness is
   `GET /api/health`, which touches nothing, so a database outage never restarts the pods.

### Install the binary (user)

6. **Get the installer.** The web app serves `GET /install.sh` (`web/src/app/install.sh/route.ts`). Its
   content is `tui/install.sh`, embedded at build time by `web/scripts/embed-install-sh.mjs`. The route
   inserts `JARVIS_CLOUD_URL="${JARVIS_CLOUD_URL:-<origin>}"` after the shebang, so
   `curl -fsSL <origin>/install.sh | sh` points at the deployment that served it. A value the user
   exported still wins.
7. **Build on the machine.** `tui/install.sh` asks to install `bun` if it is missing. When piped, it clones
   the repo (`JARVIS_REPO` overrides the URL). Then it runs `bun install --frozen-lockfile` and
   `bun build --compile`, because bun embeds the host's native `libopentui`, so the binary must be built
   on the platform it runs on. The binary goes to `--prefix` (default `~/.local/bin`). The script prints
   the line to add to PATH if needed.
8. **Seed config and assets.** Only when no global `jarvis.jsonc`/`jarvis.json` exists, it copies
   `tui/jarvis.jsonc` and `tui/jarvis.schema.json` into the config dir, adding `"cloud"` when a cloud URL
   is known. It copies the shipped agents (`analyst`, `butler`, `draftsman`, `mechanic`, `sentry`) when
   absent, and the shipped skills file by file without overwriting.
9. **Optional units.** `--service [dir]` installs `jarvis-work@.service` (enabled, not started; jobs run
   in `~/jarvis` by default). `--pi` installs `jarvis-pi@.service` and `jarvis-kiosk@.service`. Both need
   root. Without it, the script prints the commands to run.

### First run (user)

10. **Pair or add a key.** `jarvis` with no subcommand opens the TUI. When the config lists no models,
    the transcript says "No model yet". When the device is also unpaired, the pairing wizard opens and
    then chains into the provider wizard on the hosted preset. A paired device with no models goes
    straight to the provider wizard. Pairing is described in [Pair a device](pair-a-device.md). A paired
    device gets the hosted chat model and hosted voice in memory, with no key on disk.
11. **Tutorial.** ctrl+g or `/tutorial` shows a screen map and every key, read from the live keymap so a
    rebind cannot make it lie.

### Configure and extend (user)

12. **Config files.** `tui/src/config/config.ts` → `loadConfig` reads the global `~/.config/jarvis/jarvis.jsonc`,
    then `jarvis.json[c]` and `.jarvis/jarvis.json[c]` in each **trusted** ancestor of the cwd. Objects
    merge, arrays and scalars replace. `{env:NAME}`, `{secret:name}` and `{file:path}` are substituted.
    The schema is strict, so an unknown key is an error that names its path. Keys typed into the
    wizard go to `secrets.json` (mode 600), and the config only holds `{secret:…}` references.
    `jarvis config` lists what loaded.
13. **Trust.** A repo's `jarvis.jsonc` and `.jarvis/` (permissions, MCP commands, plugins and tools that
    are code) load only after `jarvis trust` adds it to `~/.config/jarvis/trusted.json`. Until then the TUI
    says what it skipped. Instruction files such as `AGENTS.md` still load: they are text, not code.
14. **Editor schema.** `tui/jarvis.schema.json` is generated from the zod schema with `bun run schema`.
    Never edit it by hand (AGENTS.md rule 5).
15. **Extensions.** `jarvis init` scaffolds `.jarvis/` with an example agent, command, skill, tool and
    plugin, and makes the directory a code project. Each kind is discovered in `~/.config/jarvis/<kind>/`
    and every trusted `.jarvis/<kind>/`. The nearest copy wins.
    - **Custom commands**: `commands/<name>.md` becomes `/<name>`. Its body is a prompt, and `$ARGUMENTS`
      takes the rest of the line. A file named like a built-in replaces it.
    - **Skills**: `skills/<name>/SKILL.md` with a `name` that matches the folder and a `description`. The
      agent loads one through the `skill` tool.
    - **Tools and plugins**: TypeScript files imported at startup. Load errors are shown, never fatal.
    - **Global assets**: the shipped agents and skills above. The drafting agents run without a shell,
      so they compute through the `engineering_calc` tool (`tui/src/engineering/formulas.ts`): 79 named
      formulas for electrical, structural, building-physics and low-voltage work. Each result comes
      with its unit, and many with the standard clause. They are design aids, not certification.

### Set up a Pi (user)

16. **Prepare.** Install `cage`, `chromium-browser` and `rpicam-apps`. Run `tui/install.sh --pi` as the user
    who will own the units, with the default prefix: the units run `/home/<user>/.local/bin/jarvis`.
    Add `onnxruntime-node` with `bun add onnxruntime-node`. It is not a dependency, and the hand worker
    needs it.
17. **Pair, fetch models, calibrate**: `jarvis pair`, `jarvis pi models`, then `jarvis pi calibrate`
    ([Hand gestures and drawing](hand-gestures-and-drawing.md)).
18. **Enable**: `sudo systemctl enable --now jarvis-pi@<user> jarvis-kiosk@<user>`. `jarvis-pi` runs the
    daemon with that user's XDG directories, restarts on failure and kills the worker with it.
    `jarvis-kiosk` waits for it and runs Chromium in kiosk mode under `cage` on
    `http://localhost:7331/projector`, restarting every 5 s if it exits.

## Business rules

| Rule | Value | Source |
|---|---|---|
| Installer cache | `cache-control: public, max-age=300` | `web/src/app/install.sh/route.ts` |
| Config is seeded once | only when no global config exists; an existing one is kept | `tui/install.sh` |
| Shipped agents and skills | copied only when absent (`cp -Rn` per skill file); edits survive, updates don't arrive | `tui/install.sh` |
| Trust | a file, never an env var, because Bun auto-loads a repo's `.env` | `tui/src/config/discover.ts` |
| Missing substitutions | `{env:}` and `{secret:}` become `""`; a missing `{file:}` is a `ConfigError` | `tui/src/config/config.ts` |
| Worker permissions | `jarvis work` refuses tool calls that would ask, unless started with `-y`; jobs must stay under `--root` | `tui/src/cli/work.ts` |
| Pi units | templates on the user (`%i`); the kiosk assumes uid 1000 (`XDG_RUNTIME_DIR=/run/user/1000`) and port 7331 | `tui/assets/pi/jarvis-kiosk.service` |
| `jarvis pi` flags | `--port` and `--width/--height/--fps` always win; `blueprint.pi.port` and `blueprint.pi.camera` in config are ignored | `tui/src/index.tsx` |
| nginx rate limits | `/api/` 10 r/s per IP (burst 50); `/api/auth/`, `/api/device/code`, `/api/device/token`, webhooks 30 r/min (burst 15); 429 `slow_down` | `k8s/base/nginx.conf` |
| Body cap | 10 MB at nginx | `k8s/base/nginx.conf` |
| Probes | readiness every 5 s; liveness every 20 s after 15 s | `k8s/base/api.yaml` |
| Schema change | edit `web/src/server/db/schemas/`, run `pnpm --filter web db:generate`, commit the migration with it; never hand-edit `web/drizzle/meta/` | AGENTS.md rule 3 |
| New env var | add to `web/src/env.js` and `web/.env.example` in the same change | AGENTS.md rule 2 |

## When it fails

- **No first-run wizard after `install.sh`.** The seeded config already lists `anthropic` and `velocity`
  models, so JARVIS does not count as "no model yet" and the pairing wizard does not open. The status
  line shows "⚠ 2 providers have no key" until `ANTHROPIC_API_KEY` and `VELOCITY_API_KEY` are set. Either
  set the keys, or remove the `provider` and `model` entries from the global config and run `jarvis`
  again. With no models configured, a paired device gets the hosted model on its own
  (`tui/src/agent/hosted.ts` → `withHostedFallback`).
- **`install.sh: no terminal to ask on`.** The script was piped with no tty. Re-run with `--yes`
  (`curl … | sh -s -- --yes`).
- **`jarvis: …` on start.** A `ConfigError` lists each bad key path. Fix the file. A missing `{secret:}`
  does not block startup, because the TUI is where you fix it.
- **Repo config ignored.** Run `jarvis trust` in the repo.
- **Pod not ready.** `/api/ready` returns 503 while Postgres is unreachable. Check `DATABASE_URL` and the
  `db-server` pod.
- **Boot fails on env.** A variable is missing or invalid. Compare with `web/.env.example`.
- **`db:migrate` tries to create existing tables.** The ledger is missing rows. Run `db:doctor`, then
  `-- --fix`. Both scripts require SSL, so they fail against the plain local container.
- **Pi services.** Without root, `install.sh --pi` prints copy commands. The units must be installed as
  `jarvis-pi@.service` and `jarvis-kiosk@.service` for `@<user>` to work. `jarvis-work` without
  pairing logs "this device is not paired" and retries every 10 s.

## Related

- [Pair a device](pair-a-device.md): the device grant behind `/pair` and `jarvis pair`.
- [Hand gestures and drawing](hand-gestures-and-drawing.md): calibration and the projector.
- [Automations](automations.md): what `jarvis work` runs.
- [Agent turn and permissions](agent-turn-and-permissions.md): permission rules in the config.
- [Model calls and usage](model-calls-and-usage.md): the hosted model a paired device gets.
- Module docs: [tui/cli](../modules/tui/cli/README.md), [tui/config](../modules/tui/config/README.md),
  [tui/extensions](../modules/tui/extensions/README.md), [tui/engineering](../modules/tui/engineering/README.md),
  [web/frontend-shell](../modules/web/frontend-shell/README.md), [web/database](../modules/web/database/README.md),
  [`k8s/`](../../k8s/README.md).
