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

### Persona

The system prompt is two layers. The capability half — how to work, what not to invent,
which tool to reach for — never changes. The voice on top of it does:

```jsonc
{
  "persona": "jarvis",                 // or "plain", or "personas/house.md"
  "operator": {
    "name": "Maximus",
    "address": "sir",                  // how you want to be addressed
    "about": "builds hardware; prefers metric and EU standards"
  }
}
```

`jarvis` is composed, precise and unimpressed: it reports a failure in the same register as
a success, volunteers the consequence rather than only the fact, disagrees once and then
does as it is told. `plain` turns the character off without weakening a single rule above
it, which is the reason the two are separate. A path is read as markdown and used verbatim.

An unknown persona name is an error rather than a fallback — a typo should not quietly hand
you a different voice than the one you configured.

`operator` is entirely optional and absent by default. Nothing is inferred from your git
config: a name guessed from a commit you made three years ago does not belong in every
system prompt.

A new session in a directory is also told the title of the last one, so it can pick the
thread up instead of asking. Subagents are not — they are handed a task, not a conversation
they were part of yesterday.

### Agents

Two are built in: `build` (everything) and `plan` (read-only). `install.sh` seeds five more
into `~/.config/jarvis/agents/` — `draftsman` (drawings), `butler` (answers questions,
touches nothing), `sentry` (sweeps for what is broken and reports without fixing),
`mechanic` (firmware, serial, bring-up) and `analyst` (reads the numbers). Delete any of
them and re-run it to get the original back.

Add your own in config, or as markdown in `.jarvis/agents/<name>.md` — frontmatter is
settings, the body is the system prompt.

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

### Tool loading

Tool schemas are the largest fixed cost of a turn, and they are paid on every turn
whether or not the tools are used. `blueprint_edit` alone is about two thousand
tokens; the blueprint family is two thirds of the whole tool payload. A session
spent writing TypeScript should not be buying all of it.

So the same trade skills make for instructions, tools make for schemas. Jarvis
sends the core set — `read`, `write`, `edit`, `bash`, `glob`, `grep`, `list`,
`todo`, `webfetch`, plus `ask`, `task` and your own `.jarvis/tools` — and
announces the rest by name and one line in a `tool_search` tool. The model calls
`tool_search` with a name, and the schema is on the wire from the next step on. A
catalog line costs around twenty tokens against a schema's sixty to two thousand.

It cuts the tool payload by about two thirds on a cold session. MCP is the larger
win: an MCP server you are not using this session now costs nothing rather than
its full schemas in every request, forever.

Tools already used earlier in the conversation stay loaded, so the lookup is paid
once per session rather than once per turn. If the model calls a tool that is not
loaded, the call is turned into the load it needed rather than failing. And on the
last retry of a turn that keeps failing on tool names, jarvis loads everything and
sends the request it would have sent anyway — saving tokens must never be why a
turn fails.

Set `"lazyTools": false` for a model that cannot manage a two-step load. The
request that goes out then is byte-identical to the one that went out before the
option existed.

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

### Voice

Two independent halves. Listening needs a provider with an audio endpoint; speaking needs
either one that generates audio or a synthesiser on the machine.

```jsonc
"voice": {
  "model": "groq/whisper-large-v3-turbo",   // in: transcription
  "stream": true,                            // transcribe while you talk, when the model can
  "recorder": "sox -d",                      // wav-file capture, for the non-streaming path
  "capture": "arecord -q -f S16_LE -r 16000 -c 1 -t raw -",  // raw PCM, for streaming and wake

  "speak": true,                             // out: read answers aloud
  "speakModel": "openai/gpt-4o-mini-tts",    // hosted, or omit for the local synthesiser
  "speakVoice": "onyx",
  "synth": "piper --model ~/voices/en_GB-alan-medium.onnx --output_file"
}
```

The two capture overrides answer different questions and are not interchangeable: `recorder`
names a command that writes a **wav file** and stops, `capture` one that writes **raw 16 kHz
mono PCM to stdout** and never stops. Both are probed for, so neither is usually needed.

**In.** Press the mic key — or say the wake word, below — to start recording, press it again
to transcribe into the prompt. The text lands in the buffer rather than being sent, because a
misheard prompt that has already started a turn costs money to take back. Escape throws the
recording away. The first press with nothing configured opens the setup rather than reporting
that voice is off.

When the model can stream, the words appear in the status line **as you speak** rather than
after you stop, and the transcript is assembled from whichever of `delta`, `partial` and
`final` parts the provider chooses to send. Partials are shown but never written into your
buffer: a partial is a guess that gets rewritten, and rewriting somebody's prompt under their
cursor is not a thing to do to them.

Every chunk is also kept in memory, and that buffer is the fallback rather than belt and
braces. The AI SDK's OpenAI transcription model advertises streaming for *every* model id —
including `whisper-1`, whose API does not support it — so the stream is attempted, fails, and
the whole recording is uploaded as one wav instead. You get the old behaviour, not a lost
sentence. Set `"stream": false` to skip the attempt, which is worth doing on a metered
connection.

**Out.** `/speak` toggles it, `/speak test` says a line, and `/speak` with nothing installed
opens the same setup pointed the other way. Answers are spoken sentence by sentence off the
token stream, so it starts talking before the answer is finished, and **escape stops it
mid-word** — including after the turn itself has ended, while the tail is still playing.

**Barge-in.** Reaching for the microphone means *stop talking*: pressing the mic key, or
saying the wake word, cuts the speech off on the keypress rather than once the recorder is up.
The turn behind the voice carries on — its text is already on screen to read — because
interrupting the speech and abandoning the work are different intentions.

Code fences are never read out. Neither are URLs, markdown emphasis or table rules: the
terminal is already showing them, and a paragraph of TypeScript read aloud is the fastest way
to make somebody turn this off.

With `speakModel` set, speech goes to that provider. Without it, the first of `say`,
`espeak-ng` or `espeak` on PATH is used. **Piper** — the one worth having on a Pi, and the
only one that keeps working off-network — is not probed for, because it is useless until a
voice model is chosen; point `synth` at it as above. Any command works so long as it reads
the text on stdin and writes a wav to the path given as its last argument.

Nothing here is on by default. Listening and speaking are separate switches on purpose:
someone dictating prompts in an open-plan office is exactly the person who does not want the
replies broadcast back.

#### Wake word

Say "hey jarvis" and the microphone opens on its own.

```bash
jarvis wake models          # ~3.7 MB, once
bun add onnxruntime-node    # on the machine that will listen
```

```jsonc
"voice": {
  "wake": {
    "enabled": true,
    "phrase": "hey_jarvis",     // or alexa, hey_mycroft, or a path to your own .onnx
    "threshold": 0.5,
    "frames": 2,                // consecutive 80 ms chunks over the threshold
    "refractoryMs": 2000,
    "bargeIn": true             // stay listening while an answer is being read out
  }
}
```

Detection is [openWakeWord](https://github.com/dscripka/openWakeWord) — three small ONNX
models in a chain, running in their own process for the same reason the Pi's vision worker
does. **Nothing leaves the machine**: scoring is entirely local, and audio only reaches a
transcription provider after the phrase has fired.

A score arrives every 80 ms once about **1.9 seconds** of audio has accumulated, which is how
much context the two sliding windows need — a listener that has just started is genuinely deaf
for the first two seconds. Firing needs `frames` consecutive chunks over `threshold`, because
a single chunk spikes for all sorts of things that are not the phrase; `refractoryMs` then
ignores the microphone, because one real utterance scores high for most of a second and would
otherwise start ten recordings.

The listener goes deaf **while you are recording a prompt** — on ALSA the capture device is
usually exclusive, so the worker holding it is the reason push-to-talk could not open it.

It keeps listening **while an answer is being read out**, which is what `bargeIn` buys: you
cut him off by name, mid-sentence. The cost is that there is no echo cancellation here, so an
answer that happens to say the phrase out loud can wake him into his own sentence. That is
self-limiting — he stops talking, records the silence, and reports hearing nothing — but set
`bargeIn` to false and he goes deaf while speaking instead, at the price of reaching for the
keyboard to stop him.

`hey_jarvis` is a real pretrained openWakeWord model, so no training is needed. Only the last
model in the chain is phrase-specific — it is about 100 KB and trains in an afternoon — so
pointing `phrase` at your own `.onnx` is a config change rather than a fork.

`onnxruntime-node` is deliberately **not** a dependency: it is ~100 MB of native code that
only this and the Pi camera use. Without it the wake word reports what to install and the rest
of the session carries on.

#### Speaker identification

Only act on voices you have enrolled.

```bash
jarvis voice models          # ~100 MB, once
bun add onnxruntime-node     # on the machine that will listen
jarvis voice enrol Maximus   # three clips, four seconds each
jarvis voice test            # score yourself against everyone enrolled
```

```jsonc
"voice": { "speaker": { "enabled": true, "threshold": 0.86 } }
```

**This is a convenience gate, not authentication.** It keeps the person standing next to you
from talking to your workbench by accident. It is defeated by a recording of your voice, and
it decides *whose* words become a prompt — never what the agent may then do with them. The
permission gate is still the thing standing between a prompt and your filesystem, and nothing
here is a reason to loosen it.

With that said, it **fails closed**. Every way of not knowing who spoke — no audio to check, a
worker that will not start, a clip too short to score, nobody enrolled — refuses. A gate that
opens when it is confused is not a gate.

Embeddings come from WavLM base+ with an x-vector head, running locally in its own process.
It was chosen over the usual speaker embedders (ECAPA-TDNN, CAM++, WeSpeaker) for one
practical reason: it takes a **raw waveform**, where all of those want 80-dimensional
filterbank features and would have meant writing a mel front end in TypeScript and getting it
bit-exact against a reference. Measured on this model: 512 dimensions, deterministic, ~700 ms
of CPU per 3 s of audio on a desktop, and clear separation between two voices.

`0.86` is the threshold the model's authors publish. Do not take it on faith — `jarvis voice
test` prints the real scores, and enrolment prints how well your own three clips agree with
each other, which is the number that tells you whether enrolment worked at all. If your
samples do not agree with each other, they will not agree with you tomorrow.

Verification needs raw 16 kHz audio, which is the streaming path (`voice.stream`, and the wake
word). On the wav-file path there is nothing comparable to check, so the gate says so and
refuses rather than waving it through.

Enrolments live in `~/.local/share/jarvis/voices.json` at mode 0600, beside the device token
and for the same reason: an embedding cannot be turned back into audio, but it is derived from
a person's body and it does not change for the rest of their life.

### Sound

Three tones — acknowledged, you-are-needed, failed — off unless you ask for them.

```jsonc
"sound": { "earcons": true, "afterSeconds": 20, "player": "mpv --no-video" }
```

The "done" tone only fires for turns longer than `afterSeconds`, and never for one you
interrupted yourself: a beep after every two-second answer is noise, and the four-minute one
is the whole point. Nor when the answer was read out loud — that was the notification. A
permission prompt always sounds, because the turn has stopped and cannot go on without you.

The wavs are generated at startup rather than shipped, and playback spawns the first of
`afplay`, `paplay`, `aplay`, `ffplay` or `play` found on PATH — `player` overrides the probe.
A machine with none of them stays silent, which is the correct failure mode for a sound.

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

`read`, `write`, `edit`, `bash`, `glob`, `grep`, `list`, `todo`, `webfetch`,
`bash_output`, `engineering_calc`, `blueprint`, `blueprint_edit`, `blueprint_view`,
`blueprint_symbol`, `blueprint_check`, `blueprint_sync`, plus `ask` when there is a user
to answer it, `task` when subagents can be spawned, `skill` when skills exist, anything in
`.jarvis/tools/`, and every MCP tool. That set is listed to the model in the system prompt,
because a model not told which tools exist invents one — and some gateways reject the whole
request for a name they were not offered. Paths are resolved against the workspace root and
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
  voice/         wake word, streaming dictation, speaker id, wav encoding
  tools/         one file per built-in tool, plus custom.ts and skill.ts
  ui/            opentui/react components
```

`bun test` covers config merging and precedence, directory discovery, tool guards,
the permission gate, the agent loop against a mock model, custom tools in each
supported argument shape, skills, every plugin hook, session round-trips, MCP over a
real stdio server, and the transcript reducer.
