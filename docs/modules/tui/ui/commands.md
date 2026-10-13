# UI: commands and keys

Code: `tui/src/ui/builtin-commands.ts`, `tui/src/ui/provider-command.ts`, `tui/src/ui/stats-command.ts`, `tui/src/ui/code-command.ts`, `tui/src/ui/blueprint-command.ts`, `tui/src/ui/speak-command.ts`, `tui/src/config/keybinds.ts` · Verified: 2026-10-13 @ c292f2f

Part of the [UI module](README.md). User-facing usage is in [`tui/README.md`](../../../../tui/README.md).

## How a line is dispatched

`tui/src/ui/app.tsx` → `submit` looks at the first character of the submitted buffer:

| Prefix | What happens | Where |
|---|---|---|
| `!cmd` | Runs `bash -c cmd` synchronously in the cwd with `JARVIS=1`; output becomes a note. No turn, no model. | `tui/src/ui/app.tsx` → `shell` |
| `/name args` | `parseCommandLine` splits it, `dispatch` finds the command, `runCommand` executes it. Unknown names note "unknown command". Runs even while a turn is busy. | `tui/src/extend/command.ts` → `parseCommandLine`; `tui/src/ui/builtin-commands.ts` → `runCommand` |
| anything else | `turn.send`, or queued (`⏎ queued: …`) if a turn is running. | `tui/src/ui/app.tsx` → `submit` |

`@path` anywhere in the buffer opens file completion (`tui/src/ui/suggest.ts` → `suggest`); at
send time `tui/src/agent/attach.ts` turns `@image.png` into an attachment.

Built-in names and their one-line descriptions are declared in
`tui/src/extend/command.ts` → `BUILTIN_COMMANDS`. Markdown files in `.jarvis/commands/` (loaded
by `loadCommands`) become `kind: "prompt"` commands: `runCommand` expands `$ARGUMENTS` with
`expand` and sends the result, using the file's `agent` and `model` frontmatter. A markdown
command with a built-in's name replaces it.

## Built-in slash commands

All rows are cases in `runCommand` unless another symbol is named.

| Command | Args | What it does | Implemented by |
|---|---|---|---|
| `/help` | — | Notes the key list and pointers to `/provider`, `jarvis init`, `/extensions`. | `help` |
| `/new` | — | Starts a new session. | `useTurn` → `newSession` |
| `/clear` | — | Clears the on-screen transcript (session unchanged). | `useTurn` → `clear` |
| `/compact` | — | Summarizes history to shrink the model's context. | `useTurn` → `compact` |
| `/model` | — | Opens the model picker. | `pickerChoices("model")` |
| `/agent` | — | Opens the agent picker. | `pickerChoices("agent")` |
| `/sessions` | — | Opens the session picker; enter resumes, shift+D deletes (not the live one). | `pickerChoices("session")`, `tui/src/ui/app.tsx` → `removeSession` |
| `/export` | — | Writes the session to `jarvis-<session-id>.md` in the cwd. | `useTurn` → `export` |
| `/retry` | `[provider/model]` | Re-sends the last prompt, optionally to another model. | `useTurn` → `retry` |
| `/undo` | — | Reverts the file changes from the last turn. | `useTurn` → `history("undo")` |
| `/redo` | — | Re-applies what `/undo` reverted. | `useTurn` → `history("redo")` |
| `/theme` | — | Opens the theme picker (applies for this session). | `pickerChoices("theme")` |
| `/mcp` | — | Notes each MCP server's tool count or error. | `mcpReport` (module-private) |
| `/provider` | see below | Adds, inspects, tests, edits and deletes providers. | `tui/src/ui/provider-command.ts` → `providerCommand` |
| `/pair` | — | Opens the pairing wizard, or this device's pairing status with an Unpair choice. | `tui/src/ui/app.tsx` → `openPair` |
| `/blueprint` | `[name]` | With a name: opens the fullscreen editor, creating the sheet if new. Bare: the blueprint picker, or a how-to panel when the store is empty. | `tui/src/ui/app.tsx` → `openBlueprint`; `tui/src/ui/blueprint-command.ts` → `blueprintCommand` |
| `/code` | `new <name>` · `init` · `list` · `status [name]` · `push [name] [remote]` · `pull [name] [remote]` · `clone <name>` | Code projects. Default `list`. A word that names a project here is the project, anything else is a git remote. Result arrives as a note. | `tui/src/ui/code-command.ts` → `codeCommand` |
| `/stats` | `[days]` | Spend and tokens by model, agent and session (default 7 days). | `tui/src/ui/stats-command.ts` → `statsCommand` |
| `/voice` | — | Opens the provider wizard for transcription. | `tui/src/ui/app.tsx` → `openVoiceSetup` |
| `/speak` | `on` · `off` · `toggle` · `test` · `setup` (bare toggles) | Turns spoken replies on or off (persisted globally), speaks a test line, or opens the speech-provider wizard. Turning on with nothing able to speak opens the wizard. | `tui/src/ui/speak-command.ts` → `runSpeak`, `speakAction` |
| `/learn` | `<name>` | Opens the camera overlay to teach an item. Needs pairing. | `tui/src/ui/app.tsx` → `openVision` |
| `/find` | `[name]` | Opens the camera overlay finding taught items (one, or all). Needs pairing. | `tui/src/ui/app.tsx` → `openVision` |
| `/items` | — | Notes the taught items and their shot counts. | `itemsCommand` (module-private), `tui/src/pi/items-client.ts` → `listItems` |
| `/forget` | `<name>` | Forgets a taught item. | `itemsCommand`, `tui/src/pi/items-client.ts` → `forgetItem` |
| `/gestures` | `on` · `off` (bare toggles) | Hand gestures as commands; the camera runs only while on. | `tui/src/ui/app.tsx` → `setGestures` |
| `/tutorial` | — | Opens the tutorial panel. | `tui/src/ui/tutorial.ts` → `tutorialContent` |
| `/extensions` | — | Notes loaded custom tools, skills and load errors. | `extensionReport` (module-private) |
| `/exit` | — | Quits immediately. | `process.exit(0)` via `CommandDeps.quit` |

### `/provider` subcommands

`providerCommand` returns panel content, or `null` when it took over the screen itself.

| Form | Effect |
|---|---|
| `/provider` | Opens the wizard if no provider exists, otherwise the provider picker (enter views one, shift+D deletes, the top row adds one). |
| `/provider setup [preset-id]` | Opens the wizard, optionally at a preset. Bare `/provider add` does the same. |
| `/provider view [id]`, `/provider list [id]` | Panel: providers with key state, model count, default; with an id, npm, file, options (secrets shown as state only) and models. |
| `/provider add <id> [npm]` | Scripted add: writes an entry whose `apiKey` is `{env:<ID>_API_KEY}` (`tui/src/config/provider-status.ts` → `envName`) and no models, then prints the next three steps. |
| `/provider test <id>` | A real one-token request; panel shows pending, then `testPanel`. |
| `/provider change <id> <path> <value>`, `/provider set …` | Writes `provider.<id>.<path>`; value parsed as JSON if it parses. Refuses a literal secret: the leaf must be an `{env:…}`, `{file:…}` or `{secret:…}` reference. |
| `/provider delete <id> [yes]`, `/provider remove …` | Without `yes`: a confirmation panel. With it: removes the entry and its stored secret. Refuses entries declared outside the global config. |
| `/provider stats [days] [id]`, `/provider viewstats …` | Per-day turns, failures, cost, p50 latency, worst outage, last error (default 14 days). Includes never-used providers. |

## Keybindings

Defaults are `tui/src/config/keybinds.ts` → `DEFAULT_KEYBINDS`; override any action under
`keybinds` in the config (`loadKeymap`). Chords are parsed by `parseChord` and matched by
`matches`. `KEY_HELP` in `tui/src/ui/builtin-commands.ts` is the list `/help` and the tutorial print.

| Action | Default | What it does | Handled in |
|---|---|---|---|
| `submit` | `return` | Send (or take the highlighted completion) | `Editor` textarea `keyBindings`; `App` for completions |
| `newline` | `shift+return` | Newline (`ctrl+j` also inserts one, hardcoded) | `Editor` |
| `interrupt` | `escape` | Cancel a recording, else clear the queue and abort the turn and speech | `App` → `perform` |
| `exit` | `ctrl+c` | Interrupt, then exit on a second press within 2 s | `App` key handler (before overlays) |
| `clear` | `ctrl+l` | Clear the transcript | `perform` |
| `palette` | `ctrl+p` | Command picker | `perform` |
| `modelPicker` | `ctrl+o` | Model picker | `perform` |
| `agentPicker` | `shift+tab` | Agent picker | `perform` |
| `sessionPicker` | `ctrl+r` | Session picker | `perform` |
| `filePicker` | `ctrl+t` | File picker; inserts the path | `perform` |
| `newSession` | `ctrl+n` | New session | `perform` |
| `providerSetup` | `ctrl+y` | Same as `/provider` | `perform` |
| `scrollUp` / `scrollDown` | `pageup` / `pagedown` | Scroll 10 lines | `perform` |
| `scrollHalfUp` / `scrollHalfDown` | `ctrl+u` / `ctrl+d` | Scroll half a screen | `perform` |
| `scrollBottom` | `end` | Jump to newest | `perform` |
| `acceptSuggestion` | `tab` | Take the `/` or `@` completion (only while the strip is open) | `App` key handler |
| `tutorial` | `ctrl+g` | Tutorial panel | `perform` |
| `toggleReasoning` | `ctrl+f` | Fold or unfold all thinking blocks | `perform` |
| `blueprintView` | `ctrl+b` | Blueprint: hidden → pane → fullscreen → hidden | `perform` |
| `voice` | `ctrl+s` | Push-to-talk start/stop; opens the voice wizard if unconfigured | `perform` → `toggleVoice` |
| `gestures` | `ctrl+x` | Hand gestures on/off | `perform` |

### Context-dependent keys (not rebindable)

Listed in `tui/src/ui/tutorial.ts` → `CONTEXTUAL`, implemented in `App`'s key handler.

| Key | When | Does |
|---|---|---|
| `←` / `→` | Buffer empty | Previous / next agent |
| `tab` | Buffer empty, no completion open | Next model (same order as the picker) |
| `↑` / `↓` | Cursor on first / last line | Prompt history (keeps the half-written draft) |
| `↑` / `↓` | Completion strip open | Move the highlight |
| `escape` | Completion strip open | Dismiss the strip |

### Overlay keys

Each overlay owns the keyboard while open (`App`'s handler returns early), except `PairWizard`, which `App` does not check for (see the UI README's Gotchas).

| Overlay | Keys | Source |
|---|---|---|
| `Picker` (pickers and `ask` questions) | type to filter, `backspace`, `space`, `↑↓`, `enter` pick, `esc` cancel, `shift+D` then `y` delete (sessions, providers), `Other…` opens a field (`enter` send, `esc` back) | `tui/src/ui/components/dialog.tsx` → `Picker` |
| `PermissionPrompt` | `y` or `enter` allow once, `a` always, `n` or `esc` reject, `ctrl+u` / `ctrl+d` scroll | `tui/src/ui/components/dialog.tsx` → `PermissionPrompt` |
| `Panel` | `esc`, `q` or `ctrl+g` close, `↑↓`, `pageup` / `pagedown`, `ctrl+u` / `ctrl+d` | `tui/src/ui/components/panel.tsx` → `Panel` |
| `Wizard` (provider setup) | `enter` next (toggles on the models step), `ctrl+b` back, `tab` switch between pasting a key and an env var, `esc` cancel | `tui/src/ui/components/wizard.tsx` → `Wizard` |
| `PairWizard` | `enter` next, `tab` skip email, `ctrl+b` back, `esc` cancel | `tui/src/ui/components/pair-wizard.tsx` → `PairWizard` |
| `VisionView` (learn) | `space` shot, `backspace` drop last shot, `enter` teach, arrows move the box, `+` / `-` resize, `esc` close | `tui/src/ui/components/vision-view.tsx` → `VisionView` |
| `VisionView` (find) | `esc` or `q` close | same |
| `BlueprintEditor` | tool keys from `tui/src/blueprint/draw.ts` → `TOOLS` (`v` select, `f` hand on/off, `l` line, `p` polyline, `r` rect, `c` circle, `a` arc, `t` text, `d` dimension, `s` symbol), arrows move the cursor (`shift` ×10), `ctrl+arrows` pan, `enter` start/finish a shape or select, `n` connect ports, `A` arrange, `x` delete selection, `u` undo, `ctrl+r` redo, `w` save, `tab` next layer, `+` / `-` zoom, `0` fit, `g` grid, `esc` or `q` backs out one level then closes (saving) | `tui/src/ui/components/blueprint-editor.tsx` → `BlueprintEditor` |

Polyline and arc need three points and report "needs the web editor" from the terminal.

### Vim mode

With `vim: true`, `tui/src/ui/vim.ts` → `vimKey` handles normal mode (`useVim` adds `u`).
Counts (`2dd`, `3w`) work for motions and `dd`, `dw`, `cw`, `x`.

| Group | Keys |
|---|---|
| Mode | `escape` (insert → normal, cursor steps back one), `i`, `a`, `I`, `A`, `o`, `O` |
| Motions | `h`, `l`, `j`, `k`, `w`, `b`, `e`, `0`, `$`, `gg`, `G` |
| Changes | `x`, `D`, `C`, `dd`, `cc`, `dw`, `cw`, `yy`, `p`, `u` |

### Gestures

`/gestures` or `ctrl+x` turn on gesture commands. The default map is
`tui/src/config/config.ts` → `DEFAULT_GESTURE_MAP` (`thumbs_up` approve, `thumbs_down` reject,
`palm` interrupt, `call` voice, `swipe_up` / `swipe_down` scroll), overridable with
`vision.gestures`. Any keymap action name is a valid target; `tui/src/ui/app.tsx` runs it through the same
`perform` a key uses.
