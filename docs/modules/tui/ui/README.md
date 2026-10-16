# UI

Code: `tui/src/ui/` (except `tui/src/ui/voice.ts`, `tui/src/ui/speak.ts`, `tui/src/ui/speak-command.ts`, `tui/src/ui/sound.ts`) · Verified: 2026-10-15 @ 9d82895

## Purpose

The interactive terminal app that `jarvis` (no subcommand) opens: transcript, prompt, status
line, pickers, setup and pairing wizards, the blueprint pane and editor, the camera overlay and
hand gestures. It renders state and dispatches keys; the agent loop, tools, config and voice
engines live in other modules. Usage (keys, config, commands) is in
[`tui/README.md`](../../../../tui/README.md); every slash command and key is listed in
[commands.md](commands.md).

## How it works

### Rendering stack

- [OpenTUI](https://github.com/sst/opentui) with its React reconciler. `tui/src/ui/start.tsx` →
  `startTui` creates the renderer with `createCliRenderer({ exitOnCtrlC: false })` (ctrl+c is
  handled by the app so it can interrupt a turn first) and mounts `App` with `createRoot`.
- Components use OpenTUI intrinsics: `<box>`, `<text>`, `<scrollbox>`, `<textarea>`, `<input>`,
  `<select>`, `<markdown>`, `<diff>`, `<ascii-font>`.
- Animation goes through `tui/src/ui/motion.ts`. `resolveMotion` picks `full | reduced | off`
  from `JARVIS_MOTION`, then config `animations`, and forces `off` on a non-TTY or `TERM=dumb`.
  `useEnter` (fade/grow on mount), `useOscillator` (busy rail and status dot), `useFlash` (tool
  card landing) and `useTicker` (spinner and elapsed seconds) all degrade with the level. The
  oscillators mutate renderables directly, so they never re-render React.
- Theme tokens come from `tui/src/config/theme.ts`; components read `theme.<token>` and never hardcode colours.

### Boot and first run

1. `tui/src/index.tsx` loads the config through `withHostedFallback` (hosted chat and voice
   entries for a paired device) and calls `startTui`.
2. `startTui` opens or resumes the session, starts MCP and loads extensions in parallel, fires
   `pushSessions` (session mirror, never awaited) and collects startup notes (extension and MCP
   errors, `trustNotice` when the repo's own config is being ignored, plus `hostedGuidance` when
   there is no model).
3. `tui/src/ui/boot.ts` → `collectBoot` gathers the facts once (credentials, previous session,
   voice settings, enrolled voices). It never throws. `bootReport` turns them into the
   `link / loaded / voice / voices / last` rows that `Welcome` shows above an empty prompt.
4. A `process.on("exit")` hook kills background shells, deletes earcon and speech temp files
   (`cleanupSounds`, `cleanupSpeech`) and closes MCP.
5. In `App`, a one-shot effect opens the first-run flow. With no model and no pairing
   (`autoPair`) it opens pairing and remembers `HOSTED_PRESET_ID` in `resumeSetupWith`;
   when pairing finishes, `closePairing(true)` opens the provider wizard on the hosted preset.
   With no model but a pairing (`autoSetup`) it opens the provider wizard directly. Backing out
   of pairing still opens the wizard, because a first run without a model has nothing to do.

### Tutorial

ctrl+g (`tutorial` action) or `/tutorial` opens a `Panel` with `tui/src/ui/tutorial.ts` → `tutorialContent`:
a screen map (dropped if the panel is narrower than the map), every key from the live keymap via
`KEY_HELP`, the context-dependent keys (`CONTEXTUAL`) and a "worth knowing" list. Keys are
described from the live keymap so a rebind cannot make this screen lie.

### App structure

`tui/src/ui/app.tsx` → `App` owns all screen state. The turn itself is in `useTurn`; the
component is mostly layout plus wiring.

| State | What it is |
|---|---|
| `config` | Live config. `reloadConfig` re-reads it after any in-app write (provider wizard, `/provider change`, `/speak on`), calls `forgetProvider` so the cached factory is rebuilt, and re-selects a model if the current one vanished. MCP and extensions are deliberately not reloaded. |
| `picker`, `panel`, `setup`, `pairing`, `vision` | The overlays. Mutually exclusive by construction: `Modal` has no backdrop and a fixed `zIndex` of 100, so two open at once would interleave. |
| `queued` | Prompts typed while a turn runs. Kept here, not in `useTurn`, so the agent loop never learns a queue exists. An effect sends the next one when `busy` and `compacting` drop. |
| `blueprintView` | `hidden → pane → full`. Opens itself to `pane` (or `full` if too narrow) the first time the agent touches a blueprint, once only. |
| `gesturesOn` | Hand-gesture commands; starts at `vision.autostart`. |
| `recording`, `heard`, `voice` ref | Push-to-talk state; see the [voice module](../voice/README.md). |

Other effects in `App`:

- **Remote steering** (`config.remoteSteering`): while idle, polls `claimPrompt` every 5 s and
  sends what arrives through `turn.send`, so the permission gate still applies. A prompt that
  arrives after the effect was torn down (a local turn started) is parked in `parked` and
  delivered on the next idle run, but only into the same session.
- **Error toasts**: the newest error note is also toasted, since it may land below the scroll.
- **Copy on select**: a finished mouse selection is copied with OSC 52 (works over ssh) and the
  status line says "copied to clipboard" for 1.5 s.
- **Git**: `tui/src/ui/git.ts` → `readGit` runs once at start and after each turn, never per render.

### Input path

1. The `Editor` textarea is always focused unless an overlay is open. It is not locked during a
   turn; what you send is queued.
2. `App`'s `useKeyboard` handler runs first for every key, in this order: `exit` (outranks every
   overlay), then bail out if an overlay owns the keyboard, then `vim.handle`, then the
   completion strip (up/down, tab, enter, esc), then history recall (up/down at the first or last
   line), then agent cycling (left/right on an empty buffer), model cycling (tab on an empty
   buffer), and finally `PERFORMED.find(...)` → `perform(action)`.
3. On every buffer change `tui/src/ui/suggest.ts` → `suggest` offers `/command` completions (whole buffer)
   or `@path` completions (last token), ranked by `rank`, max 5.
4. `submit`: `!cmd` runs `bash -c` synchronously in the cwd with `JARVIS=1` and writes a note;
   `/name args` goes to `dispatch` → `tui/src/ui/builtin-commands.ts` → `runCommand`; anything else is sent,
   or queued if a turn is running.

### The turn loop

`tui/src/ui/use-turn.ts` → `useTurn` owns the session, transcript items, usage, the permission
and `ask` prompts, and runs the agent. `send(prompt)`:

1. Appends a `user` item, expands `@file` attachments (`attach`), appends the message to the
   session JSONL, opens an undo group (`beginGroup`) and an `AbortController`.
2. If `voice.speak` is on, creates a `speaking` session for this turn.
3. Cost guard: once `spent ≥ maxCost` (when `maxCost > 0`), asks a `budget` permission before
   running; on approval the next ceiling is `spent + maxCost`.
4. Runs `tui/src/agent/agent.ts` → `run` with the `PermissionGate`, MCP and extension tools, `askUser` for the
   `ask` tool, and `onEvent`, which folds each event into items with `tui/src/ui/transcript.ts` →
   `applyEvent` and pushes top-level text deltas to the speech session.
5. If the provider reports a context overflow, compacts (`compactSession`) and retries once.
6. On success: appends the response messages, records metrics (`record`), adds cost, stores
   `contextTokens`, generates a title once per session (`generateTitle`), and auto-compacts when
   prompt tokens exceed 85% of the context window (`COMPACT_AT`).
7. `finally`: stops or flushes speech (flush is not awaited, so the next prompt is typeable while
   the tail plays), plays the `ack`/`fail` earcon for turns longer than `sound.afterSeconds` when
   nothing was spoken, closes the undo group, clears any open prompt, and fires `pushSession`
   and `autoSync` without awaiting them.

Permission prompts go through `ask`: plays the `attention` earcon, shows `PermissionPrompt`, and
with `remoteApproval` on races the local answer against `remoteAnswer` from the paired cloud.
With `persistGrants` on, an "always" answer is written with `persistPermission`
(`bash:<subject>` for shell commands). `observe` attaches the diff a tool showed the gate to that
tool's card by `callID` (`attachPatch`), so the transcript keeps it after the prompt closes.

Compaction only shrinks what the model carries; the on-screen transcript is untouched. Other
`Turn` methods: `retry(model?)`, `history("undo" | "redo")` (file snapshots), `export`
(`jarvis-<id>.md` in the cwd), `newSession`, `resume`, `clear`, `interrupt`, `hush`.

### Layout and panes

```
┌ row (flexGrow 1, basis 0, overflow hidden) ─────────────────────┐
│ BlueprintPane (when blueprintView = pane) │ Welcome / scrollbox  │
│                                            │   Welcome + Messages │
└──────────────────────────────────────────────────────────────────┘
Activity          (while busy or compacting)
Suggestions       (completion strip)
PermissionPrompt  or  Editor
completion key hint
Status
overlays: Picker (ask / pickers), PairWizard, Wizard, Panel, BlueprintEditor, VisionView, Toasts
```

- `splitWidth` gives the drawing pane 75% of the width but keeps at least 30 columns for the
  transcript, with a 24-column floor for the pane. Below 54 columns the pane is skipped and the
  view goes straight to fullscreen. The drawing gets the larger share because braille loses real
  resolution per column, while the transcript only wraps.
- An empty session renders `Welcome` centred in a plain box (a scrollbox anchored to the bottom
  cannot centre); a non-empty one puts `Welcome` and `Messages` in a sticky-bottom scrollbox.
- `Messages` renders user items with a grey rail, assistant items as `Markdown` with an accent
  rail, `Reasoning` folded to a header (live tail of 3 lines while streaming), and `ToolCard`
  (one line when done, 8-line preview while running or failed, 30 lines for blueprint drawing
  tools, a click-to-unfold diff when a patch is attached).
- `Toasts` float bottom-right at `zIndex` 50 (under dialogs), max 3, lingering 3/5/8 s by level.

### Status line

`tui/src/ui/components/status.tsx` → `Status`, one row:

`●/○` busy dot (pulses) · `INS`/`NOR` when vim is on · agent · model · *(spacer)* · gesture
readout (`✋ palm 0.9 · 30fps 40ms`) · provider-health warning · hint · cost · `dir ⑂ branch*` ·
context `12.3k/200.0k 6%` (or total tokens before the first turn).

`segments` decides what fits: the model, the hint and any warning always stay; the optional
groups drop from the left (cost first, then location, context last). Context uses the last
turn's prompt tokens, not session totals, which would count history once per step. The hint is
the live transcript tail while dictating, else "recording", "copied to clipboard",
"ctrl+c again to exit", or "ctrl+p commands".

### Vim mode

`tui/src/ui/vim.ts`, on with `vim: true`. `vimKey` is a pure reducer over
`(state, key, text, cursor)`; `useVim` holds the mode, one unnamed register and a 50-deep undo
stack, and `App` consults `vim.handle` before anything else. It starts in insert mode (the box is
for composing, so normal-mode-first would mean pressing `i` every session) and resets to insert on
submit. Ctrl and meta chords always pass through. Supported keys are listed in
[commands.md](commands.md#vim-mode). Not implemented on purpose: named registers, marks, macros,
visual mode, `:` commands, search.

### Wizards

- Provider setup: `tui/src/ui/provider-setup.ts` is a pure reducer (`beginSetup`, `submitStep`,
  `backStep`, `switchKeyMode`, `toggleModel`, `stepSpec`, `draftEntry`, `planWrites`) over a
  `Draft`. Steps are `preset → id → npm → baseURL → keyMode → key | envName → models → test`,
  each skipped when the preset already answers it (`asks`). `kind: "transcribe" | "speak"` drops
  `id`, `models` and `test` and writes `voice.model` or `voice.speakModel` (+ `voice.speak`).
  `App` runs model discovery on the models step and `testProvider` on the test step, then
  `saveSetup` checks (`checkEntry`, `checkMerged`), applies the writes to the global config and
  reloads. Keys are stored as `{secret:…}` references, never in the config. Presets are in
  `tui/src/ui/provider-presets.ts` (`PRESETS`, `VOICE_PRESETS`, `SPEAK_PRESETS`). Choosing a preset that
  `requiresPairing` on an unpaired device opens pairing first and resumes.
- Pairing: `tui/src/ui/pair-setup.ts` is the same kind of reducer (`status | url → email → confirm →
  waiting → done`); the network calls are `tui/src/cli/pair-flow.ts` (`requestCode`, `pollForToken`),
  driven by an effect in `App` keyed on the step and code so the countdown does not restart the
  poll. An already-paired device opens on `status` with an Unpair choice.

### Blueprints, camera and gestures

- `tui/src/ui/components/blueprint-view.tsx`: `useDoc` reads a blueprint (errors are shown, not thrown),
  `Picture`/`Cells` render braille cells in colour runs, `BlueprintPane` is the read-only side pane.
  `tui/src/ui/transcript.ts` → `activeBlueprint` finds the drawing from the last `blueprint*` tool call, so
  the store needs no watcher.
- `tui/src/ui/components/blueprint-editor.tsx` → `BlueprintEditor`: the fullscreen editor, reusing the web
  editor's `TOOLS`, `shapeFrom`, `applyOps`, `hitTest`. Edits are a local op journal; leaving
  saves (`writeDoc` commits). `f` draws by hand through `tui/src/ui/components/use-hand-pen.ts` → `useHandPen`
  (pinch-to-draw from `tui/src/pi/gestures.ts`, One-Euro smoothed, `fitStroke` on release).
- `tui/src/ui/components/vision-view.tsx` → `VisionView`: the full-screen camera for `/learn`
  (aim a box, take shots, `teachItem`) and `/find` (`findItems` on the newest frame, one request
  in flight). It is laid out like the blueprint editor: the picture, a 30-column side panel, a status
  line and a key line. In find mode the panel lists every taught item (`listItems`, fetched when it
  opens and after a teach) with a swatch in its `itemColours` colour, its score and its place, or
  "not in view". `↑`/`↓` pick a row, `enter` finds only that item, `a` finds all again. The `find_item`
  tool opens it too, through `showItems` (`app.tsx` → `showItems.current`): only when no other overlay
  is open, and never replacing an open one. Hidden, not closed, while a permission or question is up,
  so shots survive.
- `tui/src/ui/components/camera-canvas.tsx` → `CameraCanvas`: the live feed in half-block pixels, with
  `Mark`s (`{box, rgb, label?}` in camera pixels) drawn over it as unfilled 1-pixel rectangles and label
  chips. It reads the size and the marks through a ref, so the frame loop never restarts. The caller owns
  the `Feed`. Anything that can produce marks can draw on the camera with it.
- `tui/src/ui/use-gestures.ts` → `useGestures`: hand frames from `remoteSource` (the paired cloud) through
  `GestureCommands`, mapped by `vision.gestures`. `approve`/`reject` answer a permission prompt;
  other actions call the same `perform` a key would, except while an overlay is open (only
  `interrupt` and `voice` still work). Disabled while the fullscreen editor has the camera.

## Files

| File | Responsibility |
|---|---|
| `tui/src/ui/start.tsx` | `startTui`: session, MCP, extensions, boot facts, renderer, exit cleanup, mounts `App` |
| `tui/src/ui/app.tsx` | `App`: screen state, overlays, key dispatch, voice wiring, wizards' effects, layout; `splitWidth` |
| `tui/src/ui/use-turn.ts` | `useTurn`: session, transcript, agent run, permissions, cost guard, compaction, speech per turn; `restore` |
| `tui/src/ui/transcript.ts` | `Item` types, `applyEvent` reducer, `attachPatch`, `activeBlueprint`, `summarize` |
| `tui/src/ui/builtin-commands.ts` | `runCommand` (slash command table), `KEY_HELP`, `help` |
| `tui/src/ui/provider-command.ts` | `/provider` subcommands: `providerCommand`, `testPanel`, `testPendingPanel` |
| `tui/src/ui/stats-command.ts` | `/stats`: `statsCommand` (spend by model, agent, session) |
| `tui/src/ui/code-command.ts` | `/code`: `codeCommand`, argument parsing over `tui/src/code/tools.ts` |
| `tui/src/ui/blueprint-command.ts` | `blueprintCommand`: the empty-store panel for bare `/blueprint` |
| `tui/src/ui/provider-setup.ts` | Provider wizard reducer: steps, validation, `draftEntry`, `planWrites` |
| `tui/src/ui/provider-presets.ts` | `PRESETS`, `VOICE_PRESETS`, `SPEAK_PRESETS`, `presetChoices`, `HOSTED_PRESET_ID`, `DEFAULT_NPM` |
| `tui/src/ui/pair-setup.ts` | Pairing wizard reducer: `beginPair`, `submitStep`, `backStep`, `stepSpec` |
| `tui/src/ui/pickers.ts` | `PickerKind`, `PICKER_TITLES`, `pickerChoices`, `listFiles`, `ADD_PROVIDER` |
| `tui/src/ui/suggest.ts` | `/` and `@` completion: `suggest`, `completion` |
| `tui/src/ui/vim.ts` | `vimKey` reducer and `useVim` hook |
| `tui/src/ui/boot.ts` | Startup report: `collectBoot`, `bootReport`, `since` |
| `tui/src/ui/tutorial.ts` | `tutorialContent` panel |
| `tui/src/ui/git.ts` | `readGit`, `parseGit`, `gitEmail` (pairing prefill) |
| `tui/src/ui/motion.ts` | `resolveMotion`, `lerpHex`, `useTicker`, `useEnter`, `useOscillator`, `useFlash` |
| `tui/src/ui/use-gestures.ts` | `useGestures` (gestures as commands), `GLYPHS` |
| `tui/src/ui/components/editor.tsx` | `Editor` prompt with mic button, `EditorHandle`, `MIC` |
| `tui/src/ui/components/messages.tsx` | `Messages`, tool cards, reasoning blocks; `patchStat`, `outputBudget`, `reasoningLines` |
| `tui/src/ui/components/markdown.tsx` | `Markdown` wrapper and themed `syntaxStyle` |
| `tui/src/ui/components/status.tsx` | `Status` line, `segments`, `BRANCH_MARK` |
| `tui/src/ui/components/activity.tsx` | `Activity`: spinner, elapsed time, running tool, queue count |
| `tui/src/ui/components/suggestions.tsx` | `Suggestions`: the completion strip |
| `tui/src/ui/components/dialog.tsx` | `Modal`, `Picker`, `PermissionPrompt`, `wrapText`, `clip`, `tail`, `PATCH_HEADER` |
| `tui/src/ui/components/panel.tsx` | `Panel` read-only overlay, `panelWidth`, `panelBody`, `PanelContent` |
| `tui/src/ui/components/wizard.tsx` | `Wizard` (provider setup overlay), `SecretField`, `RESULT_CHOICES` |
| `tui/src/ui/components/pair-wizard.tsx` | `PairWizard` overlay with QR, code and countdown |
| `tui/src/ui/components/toast.tsx` | `useToasts`, `Toasts` |
| `tui/src/ui/components/welcome.tsx` | `Welcome`: wordmark, cwd, branch, boot rows, key hints |
| `tui/src/ui/components/blueprint-view.tsx` | `BlueprintPane`, `Picture`, `Cells`, `useDoc`, `palette` |
| `tui/src/ui/components/blueprint-editor.tsx` | `BlueprintEditor` fullscreen editor, `cameraToSheet` |
| `tui/src/ui/components/use-hand-pen.ts` | `useHandPen`, `readHand`, `HAND_LEGEND` |
| `tui/src/ui/components/vision-view.tsx` | `VisionView`, the full-screen camera for `/learn` and `/find`: the items panel and the keys |
| `tui/src/ui/components/camera-canvas.tsx` | `CameraCanvas`: half-block camera feed with `Mark` outlines; `fit`, `hexRgb`, `rgbHex` |

## Interfaces

- **Slash commands and keys**: see [commands.md](commands.md). Built-in names and descriptions
  are declared in `tui/src/extend/command.ts` → `BUILTIN_COMMANDS`; behaviour is in
  `runCommand`. Markdown commands from `.jarvis/commands/` become prompts.
- **Config keys read here**: `keybinds`, `theme`, `animations`, `vim`, `model` (written back on
  every model switch), `maxCost`, `persistGrants`, `remoteApproval`, `remoteSteering`,
  `vision.*` (`autostart`, `gestures`, `minScore`, `holdMs`, `cooldownMs`, `camera`,
  `threshold`), `blueprint.pi.gestures`, `blueprint.pi.fit`, `cloud`, plus the `voice.*` and
  `sound.*` keys documented in the voice module.
- **Env**: `JARVIS_MOTION` (`full | reduced | off`), `JARVIS_CLOUD_URL` (pairing prefill),
  `TERM=dumb` (motion off). Shell commands run with `JARVIS=1`.
- **Exports used elsewhere**: `startTui` (from `tui/src/index.tsx`), `PRESETS` and `DEFAULT_NPM`
  (from `tui/src/agent/model-discovery.ts` and `tui/src/agent/hosted.ts`).

## Data and state

- Writes the global config (`tui/src/config/persist.ts` → `globalConfigFile`) for model switches,
  provider wizard results, `/provider add|change|delete` and `/speak on|off`; secrets go to the
  secrets store via `{secret:…}` references.
- Writes `credentials.json` on pairing and removes it on unpair.
- Session JSONL and snapshots through `tui/src/agent/session.ts` and `tui/src/tools/snapshot.ts`; metrics through
  `tui/src/agent/metrics.ts`; `/export` writes `jarvis-<session-id>.md` into the cwd.
- Blueprint documents through `tui/src/blueprint/store.ts` (`writeDoc` commits on save).
- In-memory only: prompt history, type-ahead queue, read-file map, vim register and undo stack,
  toasts. Nothing survives a restart except the session file.

## Depends on / used by

- **Depends on**: agent (`run`, sessions, compaction, metrics, provider resolution and tests,
  remote prompt and approval), tools (`PermissionGate`, snapshots, background shells), config
  (schema, keybinds, theme, persist, provider status), extensions (commands, MCP), blueprint
  (store, render, ops), pi (gestures, hand source, camera, items client), code (`codeAction`,
  `autoSync`), cli (`tui/src/cli/pair-flow.ts`), voice (dictation, wake, speaker, speech, earcons).
- **Used by**: `tui/src/index.tsx` (default command). The agent module reads the presets.

## Gotchas

- Only one overlay at a time. `Modal` has no backdrop and a fixed `zIndex`, so `App` gates every
  overlay on the others being closed rather than stacking them.
- ctrl+c (exit) is checked before any overlay. It cancels recording, clears the queue, interrupts
  the turn, and only a second press within 2 s exits. Escape (interrupt) cancels a live
  recording first and leaves the turn alone; with no recording it clears the queue and aborts.
- `pairing` is missing from the overlay check in `App`'s key handler and from the `Editor`'s `focused` condition, so while the pair wizard is open, app-level keys (ctrl+p, vim, history) still act and the prompt keeps focus. Looks unintended; every other overlay is in both lists.
- Key handlers run in `App` before the textarea; `key.stopPropagation()` is what stops the
  completion strip's keys from also typing.
- Default chords avoid traps: `ctrl+h` is backspace in many terminals (tutorial is `ctrl+g`),
  `ctrl+b` is the tmux prefix (press twice inside tmux), `ctrl+s` is XOFF if a terminal keeps
  flow control, and alt chords are unreachable in most macOS terminals.
- Enter takes the highlighted completion, except when the token already equals it (`/clear`
  fully typed), where it sends.
- Several effects deliberately leave dependencies out (`pairing`, `setup`, `turn`, `tested`)
  because depending on them restarts a poll, aborts a lookup, or reopens the microphone. The
  comments next to each `eslint-disable` explain which.
- Pickers build their choices once per open (`useMemo` on `picker`), since `listFiles` spawns git.
- The `ask` tool's `""` answer is the dismissal sentinel; `Picker` never sends an empty `Other…`.
- The masked key field is hand-rolled (`SecretField`) because OpenTUI's `<input>` has no conceal
  option; `usePaste` is required because single-key capture cannot see a bracketed paste.
- `ponytail:` the blueprint editor's op journal is local state rather than shared with the web
  editor's copy; extract it when a third caller appears. `VisionView`'s downscale is
  nearest-neighbour; use a box filter if it shimmers.

## Tests

Run from `tui/`: `bun test` (all) or `bun test test/<file>`.

| Test | Covers |
|---|---|
| `tui/test/ui.test.ts` | `suggest`, `applyEvent`, `attachPatch`, `activeBlueprint`, `restore`, `segments`, `parseGit`, `resolveMotion`, `lerpHex`, `pickerChoices`, `runCommand`, `outputBudget`, `patchStat`, `reasoningLines` |
| `tui/test/vim.test.ts` | `vimKey` |
| `tui/test/thinking.test.tsx` | Reasoning blocks and tool-card diffs folding on click in `Messages` |
| `tui/test/editor-ui.test.tsx` | `Editor` push-to-talk button (label, narrow width, click) |
| `tui/test/dialog-ui.test.tsx` | `wrapText`, the `ask` question `Picker` and its `Other…` field |
| `tui/test/blueprint-ui.test.tsx` | `BlueprintEditor`, `BlueprintPane` |
| `tui/test/boot.test.ts` | `bootReport`, `since` |
| `tui/test/provider-setup.test.ts` | Provider wizard reducer and `presetChoices` |
| `tui/test/pair-setup.test.ts` | Pairing wizard reducer |
| `tui/test/provider-runtime.test.ts` | Status line provider warning (`segments`); mostly agent/hosted tests |

No direct tests: `tui/src/ui/app.tsx`, `tui/src/ui/start.tsx`, `tui/src/ui/use-gestures.ts`, `tui/src/ui/provider-command.ts`,
`tui/src/ui/stats-command.ts`, `tui/src/ui/code-command.ts`, `tui/src/ui/tutorial.ts`, `tui/src/ui/components/vision-view.tsx`, `tui/src/ui/components/camera-canvas.tsx`, `tui/src/ui/components/pair-wizard.tsx`,
`tui/src/ui/components/wizard.tsx`, `tui/src/ui/components/toast.tsx`, `tui/src/ui/components/welcome.tsx`.
