# Config

Code: `tui/src/config/`, `tui/scripts/emit-schema.ts`, `tui/jarvis.jsonc` · Verified: 2026-10-14 @ c9135de

## Purpose
Loads and validates `jarvis.jsonc`, defines every config key (one zod schema), resolves the XDG
paths and the `.jarvis` resource directories, and writes config changes back without losing
comments. Also holds keybinds, themes, stored secrets, and provider credential diagnostics.
Usage: [tui/README.md → Configuration](../../../../tui/README.md#configuration).

## How it works

**Discovery** (`discover.ts`):
- `projectRoot(cwd)`: nearest ancestor with `.git`, else the filesystem root. Every upward walk
  stops here so a stray config above the repo cannot leak in.
- `ancestors(cwd)`: root down to cwd, outermost first.
- **Trust** (D-12): a repo's config can set `permission`, `baseURL`, `{secret:}`/`{file:}` values,
  MCP and `check` commands, and `.jarvis/{plugins,tools}` is code imported at startup, so none of
  it loads until the user trusts the directory. `trustedDirs()` reads
  `~/.config/jarvis/trusted.json` (an array of absolute paths); `isTrusted(dir)` is true for a
  listed directory or anything under it (`within`, which `cli/work.ts` also uses);
  `trust(dir)` appends one (`jarvis trust`). `trustedAncestors(cwd)` = the trusted subset of
  `ancestors(cwd)`. `untrustedConfig`/`trustNotice` name what was skipped, for the startup line.
- `jarvisDirs(cwd)`: `~/.config/jarvis`, then `<ancestor>/.jarvis` for each **trusted** ancestor.
- `resourceDirs(cwd, kind)` / `resourceFiles(cwd, kind, ext)`: existing `<dir>/<kind>` folders,
  singular and plural both accepted (`agent`/`agents`, …). Order = nearest last, so later wins.

**Loading** (`config.ts` → `loadConfig`):
1. `configFiles(cwd)`: global `jarvis.jsonc`/`jarvis.json`, then for each trusted ancestor its
   `jarvis.json[c]` and `.jarvis/jarvis.json[c]`.
2. Each file: JSONC parse (trailing commas allowed) → `substitute` expands `{env:NAME}`,
   `{secret:name}` and `{file:path}` (relative to that file's directory).
3. `merge` folds them: objects merge recursively, arrays and scalars replace.
4. `ConfigSchema.safeParse` applies defaults; failures throw `ConfigError` listing each path.

**Writing**:
- `persist.ts` → `persistConfig(file, path, value)` uses jsonc-parser `modify`/`applyEdits`, so
  comments and formatting survive. `undefined` deletes the key.
- `persistPermission` writes into the project's `.jarvis/jarvis.jsonc` (grants are per-codebase);
  `globalConfigFile` is where providers go (credentials belong to the user, not a repo).
- `provider-plan.ts`: the provider wizard builds a list of `Write`s, validates with `checkEntry`
  (strict provider schema) and `checkMerged` (whole config + model resolves), then
  `applyWrites` writes secrets first, config second, so the reload never sees a dangling
  `{secret:…}`.

**Secrets** (`secrets.ts`): keys typed into the TUI go to `~/.config/jarvis/secrets.json`
(chmod 600). The config only stores `{secret:<provider>-api-key}`. `readSecrets` never throws.

**Credential diagnostics** (`provider-status.ts`): `reachability` re-reads the raw config files
(without substitution) to recover the `{env:…}`/`{secret:…}` name behind each provider's key
option, and classifies it `ok`/`empty`/`absent`. `explainAuth` turns an auth-shaped error into
"no usable API key — `X` is not set in this shell"; `providerHealth` feeds the status line.

**Schema for editors**: `bun run schema` runs `tui/scripts/emit-schema.ts`, which writes
`tui/jarvis.schema.json` from `ConfigSchema` (`z.toJSONSchema`, draft-7, input shape).

## Files
| File | Responsibility |
|---|---|
| `tui/src/config/config.ts` | `ConfigSchema` and sub-schemas, `loadConfig`, `configFiles`, `merge`, `substitute`, `ConfigError`, `DEFAULT_GESTURE_MAP`, types |
| `tui/src/config/discover.ts` | `projectRoot`, `ancestors`, `within`, trust (`trustedDirs`, `isTrusted`, `trust`, `trustedAncestors`, `untrustedConfig`, `trustNotice`), `jarvisDirs`, `resourceDirs`, `resourceFiles`, `ResourceKind` |
| `tui/src/config/paths.ts` | `configDir`, `dataDir`, `sessionDir`, `projectDir`, `configNames` |
| `tui/src/config/persist.ts` | `persistConfig`, `persistPermission`, `configFileIn`, `globalConfigFile` |
| `tui/src/config/provider-plan.ts` | `Write` plan type, `checkEntry`, `checkMerged`, `applyWrites` |
| `tui/src/config/provider-status.ts` | `reachability`, `explainAuth`, `describeGap`, `providerHealth`, `envName`, `SECRET_KEY` |
| `tui/src/config/secrets.ts` | `secretsPath`, `readSecrets`, `writeSecret`, `deleteSecret`, `secretRef`, `secretName`, `secretRefName` |
| `tui/src/config/keybinds.ts` | `Action`, `DEFAULT_KEYBINDS`, `parseChord`, `loadKeymap`, `matches`, `describe` |
| `tui/src/config/theme.ts` | `Theme`, built-in `THEMES` (`jarvis`, `light`), `listThemes`, `loadTheme` |
| `tui/scripts/emit-schema.ts` | Generates `tui/jarvis.schema.json` |
| `tui/jarvis.jsonc` | Example/dev config; also the file `install.sh` seeds as the global config |

## Interfaces

**Top-level keys** (`ConfigSchema`, strict: unknown keys are errors):

| Key | Default | Notes |
|---|---|---|
| `model`, `smallModel` | — | `provider/model`; `smallModel` for titles and compaction |
| `provider.<id>` | `{}` | `name`, `npm`, `export`, `options`, `models.<id>` (`name`, `options`, `reasoning`, `contextLimit`, `outputLimit`, `cost {input, output}` USD/Mtok), `enabled` |
| `agent.<name>` | `{}` | see [agent](../agent/README.md) |
| `mcp.<name>` | `{}` | `type: "local"` (`command[]`, `environment`, `cwd`, `enabled`) or `type: "remote"` (`url`, `headers`, `enabled`) |
| `permission` | `{}` | `tool` or `tool:prefix` → `ask`/`allow`/`deny` |
| `keybinds` | `{}` | action → chord, overrides `DEFAULT_KEYBINDS` |
| `cloud` | — | prefill for `/pair`; `JARVIS_CLOUD_URL` wins |
| `theme` | `jarvis` | built-in or `themes/<name>.json` |
| `animations` | `full` | `full`/`reduced`/`off`; `JARVIS_MOTION` overrides (read in `ui/motion.ts`) |
| `vim` | `false` | modal prompt editing |
| `instructions` | `[]` | extra instruction globs |
| `persona` | `jarvis` | `jarvis`, `plain`, or a file path |
| `operator` | — | `name`, `address`, `about` |
| `check` | `{}` | glob → commands run after a write, `$FILE` substituted |
| `blueprint` | see schema | `dir`, `workspace`, `pi.{port, sketch, camera, gestures, fit}` |
| `voice` | — | `model`, `recorder`, `capture`, `stream`, `speak`, `speakModel`, `speakVoice`, `synth`, `wake.*`, `speaker.*` |
| `sound` | — | `earcons`, `player`, `afterSeconds` |
| `vision` | see schema | `gestures`, `minScore`, `holdMs`, `cooldownMs`, `autostart`, `threshold`, `camera` |
| `maxSteps` | `200` | tool steps per turn |
| `lazyTools` | `true` | deferred tool schemas |
| `maxCost` | `0` | USD per session before asking; 0 = off |
| `persistGrants` | `false` | write "always" grants to `.jarvis/jarvis.jsonc` |
| `remoteApproval` | `false` | mirror permission prompts to the cloud |
| `syncSessions` | `false` | upload transcripts |
| `code.autoSync` | `false` | commit/push code projects after each turn |
| `remoteSteering` | `false` | accept prompts typed in the web app |

**Substitutions**: `{env:NAME}` and `{secret:name}` resolve to `""` when missing; `{file:path}`
throws `ConfigError` when the file is missing.

**Default keybinds**: submit `return`, newline `shift+return`, interrupt `escape`, exit `ctrl+c`,
clear `ctrl+l`, palette `ctrl+p`, model picker `ctrl+o`, agent picker `shift+tab`, sessions
`ctrl+r`, files `ctrl+t`, new session `ctrl+n`, provider setup `ctrl+y`, scroll `pageup`/
`pagedown`/`ctrl+u`/`ctrl+d`/`end`, accept suggestion `tab`, tutorial `ctrl+g`, reasoning
`ctrl+f`, blueprint view `ctrl+b`, voice `ctrl+s`, gestures `ctrl+x`.

## Data and state
| Path | What |
|---|---|
| `~/.config/jarvis/jarvis.jsonc` (or `.json`) | Global config |
| `~/.config/jarvis/secrets.json` | Stored API keys, mode 600 |
| `~/.config/jarvis/trusted.json` | Directories whose project config and `.jarvis/` may load |
| `~/.config/jarvis/{agents,commands,tools,plugins,skills,themes}/` | Global resources |
| `<ancestor>/jarvis.json[c]`, `<ancestor>/.jarvis/jarvis.json[c]` | Project config (trusted ancestors only) |
| `<ancestor>/.jarvis/<kind>/` | Project resources (trusted ancestors only) |
| `~/.local/share/jarvis/` (`dataDir`) | Sessions (`sessions/`), metrics, packages, logs, credentials |
| `tui/jarvis.schema.json` | Generated JSON schema |

Env: `XDG_CONFIG_HOME`, `XDG_DATA_HOME` (read once at module load), plus whatever names the
config references through `{env:…}`. Nothing is cached; callers reload by calling `loadConfig`.

## Depends on / used by
- Depends on: `jsonc-parser`, `zod`. No other jarvis module.
- Used by: nearly everything. Main consumers: [agent](../agent/README.md), [cli](../cli/README.md),
  [extensions](../extensions/README.md) (`resourceFiles`/`resourceDirs`),
  [UI](../ui/README.md) (keybinds, themes, provider wizard, `persistPermission`),
  `blueprint/credentials.ts` and `blueprint/store.ts` (`dataDir`), [voice](../voice/README.md),
  [pi-vision](../pi-vision/README.md).

## Gotchas
- `configDir`/`dataDir` are module-level constants, which is why tests sandbox them with a
  preload (`tui/test/setup.ts`), not per test. The preload also trusts `tmpdir()` so tests can
  build projects there; the trust tests empty the list on purpose.
- Trust is a file, never an env var: Bun auto-loads a repo's `.env`, so an env switch would let
  the repo trust itself.
- Instruction files (`AGENTS.md`, `JARVIS.md`, … via `agent/prompt.ts`) still load from every
  ancestor, trusted or not: they are text the model reads, not config or code.
- With `persistGrants`, "always" grants in an untrusted repo are written to its
  `.jarvis/jarvis.jsonc` but not loaded back until the repo is trusted.
- `{secret:…}` resolving soft is deliberate: a deleted `secrets.json` must not make jarvis
  unstartable, since the TUI is where you fix it. Do not make it throw.
- `loadConfig` output has already lost the env var names; anything that needs them must re-read
  the raw files like `reachability` does.
- Arrays replace on merge: a project `instructions` list replaces the global one.
- `ConfigSchema` is strict; `checkEntry` exists because `persistConfig` will write anything and a
  bad key would only fail on the next launch.
- `vision.gestures` replaces the default map entirely when set.
- macOS terminals cannot send alt chords, so no default binding uses alt/meta.
- After changing `ConfigSchema`, run `bun run schema` and commit `jarvis.schema.json`.

## Tests
Run from `tui/`: `bun test`.

| Test | Covers |
|---|---|
| `tui/test/config.test.ts` | `merge`, `substitute`, `configFiles`, `ConfigSchema`, `persistPermission` |
| `tui/test/discover.test.ts` | `projectRoot`, `ancestors`, `resourceDirs`, themes, `configFiles`, trust |
| `tui/test/provider-setup.test.ts` | `provider-plan.ts`, `secrets.ts` |
| `tui/test/provider-runtime.test.ts` | `provider-status.ts` |
| `tui/test/ui.test.ts` | keybinds, themes in the UI |
| `tui/test/editor-ui.test.tsx` | keybinds in the editor |
