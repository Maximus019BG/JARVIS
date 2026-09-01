# jarvis

A terminal coding agent, in TypeScript on Bun. Chat with a model, let it read and
edit your workspace, approve anything that changes files. Every part of it —
providers, models, agents, prompts, commands, skills, custom tools, plugins,
themes, keybinds, MCP servers — is data on disk, not code you have to fork.

## Install

```bash
./install.sh
```

Builds a self-contained binary and puts it in `~/.local/bin/jarvis`, then seeds
`~/.config/jarvis/jarvis.jsonc` if you do not have one yet. Works the same on macOS
and Linux; needs `bun` on PATH to build. After that, `jarvis` runs anywhere.

```
./install.sh --prefix /usr/local/bin   install somewhere else
./install.sh --uninstall               remove the binary, keep the config
```

The binary is compiled on the machine you run the script on, because bun embeds the
host platform's `libopentui` into it — a Linux binary has to be built on Linux.

From a checkout you can also just run it: `bun install && bun run start`. To keep the
agent's `bash` and `edit` tools confined to one directory, or to skip installing bun,
run it in a container instead — see [docker/README.md](docker/README.md).

## Commands

```
jarvis                       start the interactive TUI
jarvis run <prompt...>       run one prompt headlessly and print the result
jarvis init                  scaffold a .jarvis directory in this project
jarvis models                list configured models
jarvis config                show config files, agents, tools, skills and plugins

-m, --model <provider/model> override the model
-a, --agent <name>           override the agent
-c, --continue               resume the most recent session in this directory
-s, --session <id>           resume a specific session
-y, --yes                    auto-approve tool permissions (headless)
-v, --version                show the version
```

## The `.jarvis` directory

`jarvis init` scaffolds one, with a working example of every extension point:

```
.jarvis/
  agents/<name>.md          an agent: frontmatter settings, body is its prompt
  commands/<name>.md        a /command, with $ARGUMENTS
  skills/<name>/SKILL.md    instructions the model loads only when it needs them
  tools/<name>.ts           a real tool, written in TypeScript
  plugins/<name>.ts         hooks into the agent loop
  themes/<name>.json        colors
  jarvis.json[c]            config, same schema as the root file
  package.json              deps for your tools and plugins (`cd .jarvis && bun install`)
```

Every subdirectory also works under its singular name (`agent/`, `tool/`, …), and
everything above works identically in `~/.config/jarvis/` to apply globally.

jarvis walks from the git root down to your working directory, so a `.jarvis` in a
subpackage layers on top of the one at the repo root and the nearest definition of a
name wins. `/extensions` in the TUI shows what actually got loaded, and
`jarvis config` shows the same from the shell.

## Configuration

Config is JSONC and merges from the outside in — global first, then for every
directory from the git root down to your working directory its `jarvis.jsonc` and
then its `.jarvis/jarvis.json`. The nearest file wins.

```
~/.config/jarvis/jarvis.jsonc     applies everywhere
<repo>/jarvis.jsonc               applies inside that repo
<repo>/.jarvis/jarvis.json        same, if you prefer it out of the way
<repo>/sub/dir/jarvis.jsonc       applies inside that subtree
```

Any string value can pull in a secret without hardcoding it:

- `{env:ANTHROPIC_API_KEY}` — an environment variable, empty if unset
- `{secret:anthropic-api-key}` — a key you typed into the app, kept 0600 in
  `~/.config/jarvis/secrets.json`; empty if unset
- `{file:secrets/key.txt}` — file contents, trimmed, relative to the config file.
  Unlike the other two this one is a hard error when the file is missing, so
  prefer `{secret:…}` for keys you may move around.

Run `bun run schema` to regenerate `jarvis.schema.json` for editor completion, and
point `$schema` at it.

### Providers and models

There is no bundled provider list. Name any npm package that exports an AI SDK
provider factory and jarvis installs it on first use into
`~/.local/share/jarvis/packages`.

```jsonc
{
  "model": "anthropic/claude-opus-4-5",
  "provider": {
    "anthropic": {
      "npm": "@ai-sdk/anthropic",
      "options": { "apiKey": "{env:ANTHROPIC_API_KEY}" },
      "models": {
        "claude-opus-4-5": { "name": "Claude Opus 4.5", "cost": { "input": 5, "output": 25 } }
      }
    },
    "gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "name": "gateway", "baseURL": "https://example.com/api", "apiKey": "{env:GATEWAY_KEY}" },
      "models": { "some-vendor/some-model": {} }
    }
  }
}
```

Model ids are `provider/model`, split on the **first** slash — so a model id may
itself contain slashes. `options` goes straight to the provider factory;
`cost` is per million tokens and only drives the status-line estimate. Set
`export` if the package's factory is not the first `create*` export.

### Agents

Two are built in: `build` (everything) and `plan` (read-only). Add your own in
config, or as markdown in `.jarvis/agents/<name>.md` — frontmatter is settings, the
body is the system prompt.

```markdown
---
description: Reviews diffs for correctness
model: anthropic/claude-sonnet-4-5
tools: { write: false, edit: false }
temperature: 0.2
---

You review code. Report only defects you can point at a line for.
```

Agents are switchable in the TUI and callable from any agent through the `task`
tool, which runs them with their own context window. Subagents cannot spawn
subagents.

### Commands

`.jarvis/commands/<name>.md` becomes `/<name>`. `$ARGUMENTS` is replaced with the
rest of the line; without it, the arguments are appended.

```markdown
---
description: Review a file
agent: plan
---

Review $ARGUMENTS and list anything that would break in production.
```

### Skills

`.jarvis/skills/<name>/SKILL.md` holds instructions the model loads on demand. It
sees every skill's name and description up front; the body only arrives when it calls
the `skill` tool. That keeps long, situational context out of every prompt.

```markdown
---
name: deploy
description: How to ship this service
---

Run the pipeline, wait for the smoke tests, then tag the release.
```

`name` must be lowercase alphanumeric with single hyphens and match the directory
name. Other files in the skill directory are listed to the model so it can read them.
Access is gated like any tool: `"permission": { "skill:deploy": "ask" }`.

### Custom tools

`.jarvis/tools/<name>.ts` becomes a real tool. The default export is named after the
file; a named export `bar` in `foo.ts` becomes `foo_bar`.

Arguments can be a plain JSON Schema — no dependencies, nothing to install:

```ts
export default {
  description: "Count the lines in a file",
  args: {
    type: "object",
    properties: { path: { type: "string", description: "File to count" } },
    required: ["path"],
  },
  async execute(args: { path: string }, context: { directory: string }) {
    return `${(await Bun.file(`${context.directory}/${args.path}`).text()).split("\n").length} lines`
  },
}
```

or zod, if you `cd .jarvis && bun add zod` — either a record of schemas or a single
`inputSchema: z.object({...})`. `context` carries `agent`, `sessionID`, `messageID`,
`directory`, `worktree` and `abort`.

Custom tools go through the permission gate under their own name, so
`"permission": { "myTool": "ask" }` works.

### Plugins

`.jarvis/plugins/<name>.ts` exports functions that are called once at startup and
return hooks. Each receives `{ directory, worktree, config, $ }` — `$` is Bun's shell.

```ts
export const AllowReadOnlyGit = async () => ({
  "permission.ask": async (input, output) => {
    if (input.tool === "bash" && /^git (status|diff|log)\b/.test(input.subject ?? "")) {
      output.status = "allow"
    }
  },
})
```

| Hook | Can |
|---|---|
| `tool.execute.before(input, output)` | mutate `output.args`, or throw to refuse the call |
| `tool.execute.after(input, output)` | mutate `output.output` before the model sees it |
| `permission.ask(input, output)` | set `output.status` to `allow`/`deny`/`ask`, skipping the prompt |
| `chat.message(input, output)` | rewrite `output.messages` before they are sent |
| `event(input)` | observe every agent event |
| `tool` | an object of extra tools, same shape as `tools/*.ts` |

Hooks apply to built-in, custom and MCP tools alike. A plugin that fails to load is
reported in `/extensions` and skipped — it never takes the session down.

### Instructions

`JARVIS.md` and `AGENTS.md` are picked up from the git root down to your working
directory and appended to the system prompt, nearest last. Extra files (globs
allowed) go in `instructions`.

### Permissions

Every tool that changes something routes through one gate. `write`, `edit` and
`bash` ask by default.

```jsonc
{
  "permission": {
    "bash": "ask",
    "bash:git ": "allow",   // longest matching prefix wins
    "write": "allow",
    "*": "ask"
  }
}
```

`ask` in the TUI prompts with a diff or the command; `y` allows once, `a` allows
that exact call for the session, `n` rejects and tells the model why. Headless
runs deny unless you pass `--yes`. Agents can tighten this with their own
`permission` block.

### Themes

`"theme": "jarvis"` or `"light"`, or drop a `themes/<name>.json` in any `.jarvis`
directory overriding any subset of the tokens in [src/config/theme.ts](src/config/theme.ts).
`/theme` switches at runtime.

### Keybinds

```jsonc
{ "keybinds": { "interrupt": "ctrl+g", "newline": "ctrl+j" } }
```

Defaults: `enter` send, `shift+enter` newline, `escape` interrupt, `ctrl+c`
quit, `ctrl+p` commands, `ctrl+o` model, `tab` agent, `ctrl+r` sessions,
`ctrl+t` insert file path, `ctrl+n` new session, `ctrl+l` clear.

### MCP servers

```jsonc
{
  "mcp": {
    "local-thing": { "type": "local", "command": ["bunx", "some-mcp-server"] },
    "remote-thing": { "type": "remote", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer {env:TOKEN}" } }
  }
}
```

Their tools appear as `mcp_<server>_<tool>`. A server that fails to start is
reported by `/mcp` and skipped — it never blocks startup.

## Sessions

Every conversation is append-only JSONL under
`~/.local/share/jarvis/sessions/`. `--continue` resumes the newest session for the
current directory, `--session <id>` a specific one, and `ctrl+r` picks from a list.

## Blueprints

2D technical drawings, stored as JSON and versioned with git. `blueprint` creates and
lists them, `blueprint_edit` draws with a batch of operations, `blueprint_view` renders
them as braille, SVG or raw JSON. Every edit is committed automatically, so `blueprint`
`action: "history"` and `blueprint_view` `at: "<sha>"` reach any past version.

```
/blueprint                   pick one from the store with the arrow keys
/blueprint plate             draw one in the terminal, with its history
```

The store is its own git repo at `~/.local/share/jarvis/blueprints/<workspace>`, kept
outside your project so it never nests a `.git` inside it:

```jsonc
"blueprint": {
  "workspace": "default",   // maps to a workstation in the web app
  "dir": "~/drawings"       // optional, overrides the location entirely
}
```

Blueprint names are restricted to lowercase letters, digits and hyphens — these tools
address a store outside the workspace, so the name is the sandbox.

`install.sh` seeds a `draftsman` agent and a `blueprint-drafting` skill into
`~/.config/jarvis`. Delete either and re-run it to get the original back.

### Syncing to the cloud

`/pair` inside jarvis connects this machine to a JARVIS web instance. It asks where your
JARVIS is, which account should approve the request, and what to call this machine — then
waits, showing a QR you can scan with a phone. Approve it in the web app's Devices tab,
where a request naming your email is already listed, or scan the QR to land straight on the
approval screen. Either way the web app shows the device's name and fingerprint and asks
which blueprints it may reach before anything is granted.

This is the OAuth 2.0 device authorization grant (RFC 8628), so no password or token is
ever typed on the device. Being paired also unlocks the `JARVIS (hosted)` provider, which
needs no API key of its own — which is why a first run offers pairing before it asks for a
key.

`/pair` on an already-paired machine shows what it is paired to, and offers to unpair.

The same thing without the interface, for a Pi being set up over SSH:

```
jarvis pair me@example.com                        pair, and address it to that account
jarvis pair me@example.com https://jarvis.example against a specific deployment
jarvis pair https://jarvis.example                without naming an account — code only
jarvis unpair -y                                  forget the pairing on this machine
jarvis device                                     show this device's pairing
```

Credentials land in `~/.local/share/jarvis/credentials.json` at mode `600` — deliberately
not `jarvis.jsonc`, which people commit — and survive a reboot, so pairing is a
once-per-machine step. `unpair` only clears that file; the token stays valid until it is revoked
under Settings → Devices in the web app.

The address is taken from `JARVIS_CLOUD_URL`, then the `cloud` key in your config, then
whatever the wizard asks for. `install.sh --cloud <url>` writes that key, which is why a
machine installed with the one-liner from the Devices tab never has to be told twice:

```
curl -fsSL https://jarvis.example/install.sh | sh
```

Add `--service` to that and the machine also runs `jarvis work` on boot through systemd, no
desktop or browser required.

The `blueprint_sync` tool then pushes and pulls:

```
blueprint_sync { action: "push", name: "plate" }
```

Every local commit becomes a version on the web, with its history and diffs. Pushes are
fast-forward only: if the server moved on, the push is rejected, the two versions are
three-way merged locally by entity id, and the merge is pushed instead. When both sides
edited the same entity **both survive** — yours keeps its id, theirs is renamed `e7-b` —
and the conflict is reported rather than resolved. Nothing is ever silently dropped.

Access is enforced server-side per blueprint, so a device granted one drawing gets a 403
on any other regardless of what it asks for.

### Drawing with your hands

`jarvis pi` turns a Raspberry Pi with a camera and a projector into a drawing surface. Pinch
to draw, and the stroke is fitted to a real entity — a line, circle, rectangle or curve —
and committed to git like any other edit.

```
jarvis pi models             download the hand-tracking models (once)
jarvis pi calibrate          align the camera to the projected sheet
jarvis pi plate              draw into the `plate` blueprint
```

| Gesture | Action |
|---|---|
| pinch thumb and index | pen down; release commits the stroke |
| point, hold ~400 ms | cycle the tool (auto · line · polyline · rect · circle · arc · path) |
| open palm | discard the stroke in progress |
| closed fist | undo the last entity |
| two hands pinching | zoom |

In `auto` the shape is inferred from what you drew; pick a tool and it is forced, so a
wobbly oval under the circle tool becomes a circle. Strokes snap to nearby endpoints, which
is what makes hand-drawn shapes actually join.

**Calibrate before drawing, and again whenever the projector moves.** Four markers are
projected in turn; pinch on each. The reported mean error is in millimetres — under about
2 mm is good, and anything over 5 mm warns. Nothing can derive this: it depends on where the
projector is sitting.

The projected view is at `http://localhost:7331/projector`. It is display-only — the daemon
sends it flattened geometry and ignores anything it sends back, so the browser can crash or
be closed without the drawing noticing. On the Pi it runs full-screen under `cage`, a ~2 MB
single-application Wayland compositor, which is how Raspberry Pi OS Lite gets a browser onto
HDMI without installing a desktop:

```
sudo apt install cage chromium-browser rpicam-apps
./install.sh --pi
sudo systemctl enable --now jarvis-pi@$USER jarvis-kiosk@$USER
```

Every threshold is a physical tuning knob and lives in config, because the right values
depend on the rig and on how firmly a particular person pinches:

```jsonc
"blueprint": {
  "pi": {
    "camera": { "width": 640, "height": 480, "fps": 30 },
    "gestures": {
      "pinchEnter": 0.32,   // fraction of hand span that closes the pen
      "pinchExit": 0.45,    // the looser value that opens it — must be larger
      "debounce": 3,        // frames a change must persist
      "pointHoldMs": 400
    },
    "fit": { "tolerance": 1.2, "smoothing": 0.35, "snapGrid": 0 }
  }
}
```

Pinch distance is measured in hand spans rather than pixels, so leaning closer to the camera
does not change the gesture, and the two thresholds give hysteresis — with a single value a
finger resting on it toggles the pen every other frame.

#### Without hardware

`--source=script` runs a scripted hand through the whole pipeline, so the daemon, the
projector, calibration and stroke fitting can all be exercised on a laptop:

```
jarvis pi calibrate --source=script
jarvis pi demo --source=script
```

`--source=webcam` uses `ffmpeg` instead of `rpicam-vid` for a laptop camera, and
`--source=replay --replay=<file>` replays a recorded NDJSON capture at its original pace.

#### How the vision works

Detection and landmarks both run in `onnxruntime-node`, in a **separate process** that emits
one NDJSON line per frame. It is separate on purpose: it is a native addon and the biggest
unknown on arm64, so a crash costs a restartable child rather than the daemon, and the same
worker can be run under `node` if it misbehaves under Bun. Palm detection runs every half
second and landmarks track in between, which is what keeps it inside a Pi's budget.

`onnxruntime-node` is deliberately **not** a dependency — it is ~100 MB of native code only
this path uses. Install it on the machine that needs it:

```
bun add onnxruntime-node
```

Swapping detection onto the IMX500's on-sensor accelerator later means writing one more
`HandSource` and changing nothing else.

## Tools

`read`, `write`, `edit`, `bash`, `glob`, `grep`, `list`, `task`, `blueprint`,
`blueprint_edit`, `blueprint_view`, plus `skill` when skills exist, anything in
`.jarvis/tools/`, and every MCP tool. Paths are resolved against the workspace root and
rejected if they escape it; `edit` requires the file to have been read first and refuses
an ambiguous match.

Agents pick from that set with a `tools` policy, and a trailing `*` matches by prefix:

```yaml
tools:
  write: false
  mcp_*: false
```

## Layout

```
src/
  index.tsx      CLI entry and argument parsing
  config.ts      schema, merge, {env:}/{secret:}/{file:} expansion
  discover.ts    project root, .jarvis directories, plural/singular resolution
  provider.ts    dynamic @ai-sdk/* loading and model resolution
  agent.ts       the streaming tool loop
  agent-def.ts   agent definitions from builtins, markdown and config
  extensions.ts  loads custom tools, skills and plugins once at startup
  skill.ts       skill discovery and frontmatter validation
  plugin.ts      plugin loading, hook dispatch, tool wrapping
  prompt.ts      system prompt and instruction files
  permission.ts  the single approval gate
  session.ts     JSONL persistence
  mcp.ts         MCP clients wrapped as tools
  command.ts     slash commands
  init.ts        the `jarvis init` scaffold
  theme.ts       color tokens
  keybinds.ts    keymap
  tools/         one file per built-in tool, plus custom.ts and skill.ts
  ui/            opentui/react components
```

`bun test` covers config merging and precedence, directory discovery, tool guards,
the permission gate, the agent loop against a mock model, custom tools in each
supported argument shape, skills, every plugin hook, session round-trips, MCP over a
real stdio server, and the transcript reducer.
