# Voice

Code: `tui/src/voice/`, `tui/src/ui/voice.ts`, `tui/src/ui/speak.ts`, `tui/src/ui/speak-command.ts`, `tui/src/ui/sound.ts`, `tui/src/cli/voice.ts` · Verified: 2026-10-13 @ c292f2f

## Purpose

Talking to JARVIS and hearing it answer, in the terminal: push-to-talk and streaming dictation
into the prompt, an always-on wake word, an optional speaker-identification gate, spoken replies
(TTS), and three short earcons. Audio I/O is done by spawning existing binaries (sox, arecord,
ffmpeg, afplay, say, espeak); the ONNX models run in child processes. Usage and config are in
[`tui/README.md`](../../../../tui/README.md) (Voice, Wake word, Speaker identification, Sound).

## How it works

### Providers: hosted vs your own key vs local

| Job | Hosted (paired device) | Own key | Local, no network |
|---|---|---|---|
| Transcription (`voice.model`) | `jarvis-voice/whisper-large-v3-turbo`: the web gateway's `/api/gateway/v1/audio/transcriptions`, which forwards to Groq Whisper | Groq (`whisper-large-v3-turbo`) or OpenAI (`whisper-1`) via `@ai-sdk/openai` | none |
| Speech (`voice.speakModel`) | `jarvis-speech/canopylabs/orpheus-v1-english`: `/api/gateway/v1/audio/speech`, forwarded to Groq Orpheus | OpenAI `gpt-4o-mini-tts`, ElevenLabs `eleven_turbo_v2_5` | `say`, `espeak-ng`, `espeak`, or `voice.synth` (piper) |
| Wake word | — | — | openWakeWord, 3 ONNX models |
| Speaker ID | — | — | WavLM base+ x-vector, 1 ONNX model |

- The hosted entries are injected at startup by `tui/src/agent/hosted.ts` → `withHostedFallback`
  (provider ids `HOSTED_VOICE_IDS`), never persisted; the pairing token is the API key. They use
  `@ai-sdk/openai` because only it has `.transcription()` and `.speech()`. For hosted
  transcription it forces `voice.stream: false`: the gateway has no realtime socket.
- `voice.speakModel` defaults to the hosted Orpheus model on a paired device, so turning on
  `/speak` there needs no setup.
- Wizard presets: `tui/src/ui/provider-presets.ts` → `VOICE_PRESETS`, `SPEAK_PRESETS`. The
  hosted choice is hidden until the device is paired.
- Gateway side: `web/src/server/gateway/upstreams.ts` → `AUDIO`; see the
  [web gateway module](../../web/gateway/README.md).
- Model resolution: `tui/src/agent/provider.ts` → `resolveTranscription` / `resolveSpeech`
  throw a message naming the setting when the provider has no audio method.

### Push-to-talk and dictation

The voice key (`ctrl+s`), the mic button in the prompt, or the wake word call
`tui/src/ui/app.tsx` → `toggleVoice`:

1. No `voice.model` → opens the provider wizard for transcription instead of erroring.
2. First press: `turn.hush()` (barge-in: stops any reply being spoken), sets `voice.current =
   "starting"` so a second press during model resolution cannot open a second microphone.
3. `start()`: unless `voice.stream === false`, tries `tui/src/voice/dictate.ts` → `dictate`. Only
   a `DictationError` saying the model "cannot stream" falls through to
   `tui/src/ui/voice.ts` → `listen` (push-to-talk). Any other error is reported once.
4. Second press: `stop()` → `Heard { text, pcm? }` → speaker gate → `editor.insert(text)`. The
   text lands in the buffer, never auto-submitted: a misheard prompt that starts a turn costs
   money to take back. Escape cancels without transcribing (`cancelVoice`).

| Path | Capture | Transcription | `pcm` |
|---|---|---|---|
| Streaming, `dictate` | `pickStream` command: raw 16 kHz mono s16le on stdout | `experimental_streamTranscribe` as you speak; partial text shown in the status line via `onText` | yes |
| Push-to-talk, `listen` | `pickRecorder` command writing a temp wav (`jarvis-voice-<pid>-….wav`), stopped with SIGINT so the wav header is finalized | one `transcribe` call after stop | no |

Streaming details (`tui/src/voice/dictate.ts`):

- `canStream` asks the resolved model whether it has `doStream` instead of keeping a provider list.
- `Transcript` merges the three part kinds providers send (`transcript-delta` appends,
  `transcript-partial` replaces the pending guess, `transcript-final` commits).
- Every chunk is also kept in a buffer. If the stream fails or returns nothing, `stop` encodes the
  buffer with `tui/src/voice/wav.ts` → `encodeWav` and does one batch `transcribe`, so a dropped socket does not
  lose the dictation. Under 2048 bytes is treated as a stray keypress.
- `stop` waits at most 5 s (`FINISH_TIMEOUT_MS`) for the provider to close.

### Wake word

`tui/src/voice/wake.ts` + `tui/src/voice/wake-worker.ts` + `tui/src/voice/wake-models.ts`, started by an effect in `App` when
`voice.wake.enabled` and all models exist (otherwise one error note).

1. `onnxWakeSource` spawns `bun wake-worker.ts --phrase=… [--recorder=…]` and reads NDJSON
   (`ndjson`) scores from its stdout.
2. The worker captures audio with `pickStream`, cuts it into 1280-sample chunks (80 ms,
   `fixedChunks`) and runs openWakeWord's three-stage chain:
   melspectrogram (480 samples of previous context + 1280 new) → 76 mel frames, stride 8 →
   embedding (96 values) → 16 embeddings → phrase classifier → score in [0, 1]. One score per
   80 ms after about 1.9 s of warm-up.
3. `detections` turns scores into wake events: `frames` consecutive chunks over `threshold`, then
   a `refractoryMs` window so one utterance wakes once.
4. `listenForWake` calls `onWake` → plays the `attention` earcon and calls `toggleVoice` (through
   a ref, so the listener is not rebuilt per render). Errors become one note.
5. `pause`/`resume` are a flag checked per detection, not a process restart, so the first word
   after the phrase is not lost. `App` pauses the listener while recording (ALSA capture is
   usually exclusive) and while a reply is spoken when `voice.wake.bargeIn` is false. With
   barge-in on (default) it keeps listening, so saying the phrase interrupts the reply.

`scriptedWakeSource` emits a fixed score timeline for tests without a mic or models.

### Speaker identification

A convenience gate, not authentication (the config schema says so explicitly).

- Enrolment (`tui/src/cli/voice.ts` → `runVoice`, action `enrol`/`enroll`): records 3 clips of
  4 s with `pickStream`, embeds each, stores the centroid (`tui/src/voice/speaker.ts` → `enroll`) in
  `voices.json`, and prints how well the clips agree with each other against the threshold.
- `tui/src/voice/embedder.ts` → `embedder` spawns one long-lived `tui/src/voice/speaker-worker.ts` per session (the model
  takes a second or two to load). Requests are `{ id, pcm: base64 }` lines on stdin, replies
  `{ id, embedding }` on stdout. PCM shorter than 1 s (`MIN_VERIFY_SAMPLES`) is refused; longer
  than 4 s is cut to the middle 4 s (`capPcm`). 30 s timeout per request.
- The gate is `tui/src/ui/app.tsx` → `gateVoice`, run on every finished recording when
  `voice.speaker.enabled`. It **fails closed**: nobody enrolled, no `pcm` (the push-to-talk
  path), a worker error, or a score below `voice.speaker.threshold` (default 0.86) all refuse,
  with the best score and the bar in the message (`identify`).

### Text to speech

`tui/src/ui/speak.ts`, used per turn by `tui/src/ui/use-turn.ts` when `voice.speak` is on.

1. `speaking(config, onError)` returns `{ push, flush, stop }`. `useTurn` pushes every top-level
   text delta (subagent text is not spoken).
2. `nextUtterances` splits the streaming buffer into whole sentences: blank lines and `.!?`
   end one, except after abbreviations (`e.g`, `Dr`, …), single-letter initials and numbered
   list markers. Text after an unclosed code fence is held back. `speakable` strips markdown,
   code blocks, link URLs ("a link") and table pipes.
3. Two promise chains: synthesis runs one sentence ahead of playback, playback stays ordered.
   Synthesis is the hosted model (`generateSpeech`, mp3 or wav by media type) when
   `voice.speakModel` is set, else the local `pickSynth` command (text on stdin, wav path last).
4. Playback uses the same player as earcons (`tui/src/ui/sound.ts` → `pickPlayer`). Clips are temp files
   (`jarvis-speech-<pid>-<n>.<ext>`) deleted after playing; `cleanupSpeech` removes leftovers on
   exit.
5. `turn.interrupt()` and `turn.hush()` call `stop`, which drops the queue and kills the clip in
   progress. After a normal turn `flush` is not awaited, so the next prompt can be typed while
   the tail plays; `turn.speaking` stays true until the last clip ends.
6. Errors are reported once per turn (`voice: …` note).

`/speak` is `tui/src/ui/speak-command.ts`: `speakAction` is the pure decision, `runSpeak`
persists `voice.speak` to the global config, reloads, or opens the speech wizard; `/speak test`
calls `say`.

### Earcons

`tui/src/ui/sound.ts`: three tones synthesized in memory (`synth`, wav via `encodeWav`), written
once per process to temp files, played fire-and-forget by `play(config, earcon)` when
`sound.earcons` is on.

| Earcon | Shape | Played when |
|---|---|---|
| `ack` | 880 Hz, 70 ms | A turn longer than `sound.afterSeconds` (default 20) finished and nothing was spoken |
| `attention` | 660 → 990 Hz | A permission prompt opens; the wake word fires |
| `fail` | 660 → 440 Hz | A long turn failed |

## Files

| File | Responsibility |
|---|---|
| `tui/src/voice/dictate.ts` | Streaming dictation: `dictate`, `Transcript`, `canStream`, `DictationError`, `Heard` |
| `tui/src/voice/wav.ts` | `encodeWav`, `floatToPcm`, `WAV_HEADER_BYTES` |
| `tui/src/voice/wake.ts` | Wake gate and plumbing: `detections`, `listenForWake`, `onnxWakeSource`, `scriptedWakeSource`, `STREAMS`, `pickStream`, `Window`, `pcmToFloat`, `ndjson`, `SAMPLE_RATE`, `DEFAULT_WAKE` |
| `tui/src/voice/wake-worker.ts` | Child process: capture + openWakeWord ONNX chain, NDJSON scores on stdout |
| `tui/src/voice/wake-models.ts` | Wake model paths and downloads: `wakeModelDir`, `PHRASES`, `wakeModelPaths`, `missingWakeModels`, `fetchWakeModels` |
| `tui/src/voice/speaker.ts` | Voice store and scoring: `loadVoices`, `saveVoices`, `enroll`, `forget`, `score`, `identify`, `cosine`, `centroid`, `pcmToUnit`, `voicesPath` |
| `tui/src/voice/speaker-models.ts` | Speaker model path and download: `SPEAKER_MODEL`, `speakerModelPath`, `speakerModelMissing`, `fetchSpeakerModel`, `EMBEDDING_DIMS` |
| `tui/src/voice/speaker-worker.ts` | Child process: WavLM embeddings, NDJSON request/response over stdin/stdout |
| `tui/src/voice/embedder.ts` | Parent side of the speaker worker: `embedder`, `capPcm` |
| `tui/src/ui/voice.ts` | Push-to-talk recording to a wav file: `listen`, `RECORDERS`, `pickRecorder`, `VoiceError` |
| `tui/src/ui/speak.ts` | TTS: `speaking`, `say`, `nextUtterances`, `speakable`, `SYNTHS`, `pickSynth`, `canSpeak`, `cleanupSpeech` |
| `tui/src/ui/speak-command.ts` | `/speak`: `speakAction`, `runSpeak`, `describeVoice` |
| `tui/src/ui/sound.ts` | Earcons: `play`, `synth`, `PLAYERS`, `pickPlayer`, `cleanupSounds` |
| `tui/src/cli/voice.ts` | `jarvis voice models | enrol <name> | test | list | forget <name>`: `runVoice` |

## Interfaces

**CLI** (dispatched in `tui/src/index.tsx`):

| Command | Does |
|---|---|
| `jarvis wake models [phrase]` | Downloads the shared wake models plus one phrase (default `voice.wake.phrase` or `hey_jarvis`) |
| `jarvis voice models` | Downloads the speaker model (~100 MB) |
| `jarvis voice enrol <name>` (or `enroll`) | Records 3 × 4 s and saves the voice |
| `jarvis voice test` | Records 4 s and prints every enrolled voice's score against the threshold |
| `jarvis voice list` | Lists enrolled voices |
| `jarvis voice forget <name>` | Removes a voice |

**TUI**: the `voice` key (`ctrl+s`), the mic button, `/voice` (transcription wizard), `/speak
on|off|toggle|test|setup`. See [UI commands](../ui/commands.md).

**Config keys** (`tui/src/config/config.ts`):

| Key | Default | Meaning |
|---|---|---|
| `voice.model` | hosted when paired | `provider/model` for transcription; required for voice input |
| `voice.recorder` | PATH probe | Push-to-talk command; wav path appended |
| `voice.capture` | PATH probe | Raw 16 kHz PCM-to-stdout command for dictation, wake word and enrolment |
| `voice.stream` | `true` (`false` for hosted) | Use streaming dictation when the model can |
| `voice.speak` | `false` | Read answers aloud |
| `voice.speakModel` | hosted when paired | `provider/model` for hosted TTS; unset means local synth |
| `voice.speakVoice` | — | Voice id for the hosted TTS model |
| `voice.synth` | PATH probe | Local synth command (stdin text, wav path appended); the way to use piper |
| `voice.wake.enabled` / `phrase` / `threshold` / `frames` / `refractoryMs` / `bargeIn` | `false` / `hey_jarvis` / `0.5` / `2` / `2000` / `true` | Wake word |
| `voice.speaker.enabled` / `threshold` / `model` | `false` / `0.86` / bundled | Speaker gate |
| `sound.earcons` / `player` / `afterSeconds` | `false` / PATH probe / `20` | Earcons |

## Data and state

`<data>` is `$XDG_DATA_HOME/jarvis`, or `~/.local/share/jarvis` (`tui/src/config/paths.ts` →
`dataDir`).

| Path | Contents |
|---|---|
| `<data>/models/wake/` | `melspectrogram.onnx`, `embedding_model.onnx`, and `hey_jarvis_v0.1.onnx` / `alexa_v0.1.onnx` / `hey_mycroft_v0.1.onnx`, from openWakeWord release `v0.5.1` on GitHub. A non-pretrained `phrase` is a path (relative paths resolve here). |
| `<data>/models/speaker/wavlm-base-plus-sv.onnx` | Quantized WavLM base+ SV from `huggingface.co/Xenova/wavlm-base-plus-sv` |
| `<data>/voices.json` | Enrolled voices: `{ version: 1, speakers: [{ name, embedding[512], samples, enrolledAt }] }`, mode 0600, kept out of the config on purpose |
| OS temp dir | `jarvis-voice-*.wav` (push-to-talk), `jarvis-speech-*` (TTS clips), `jarvis-earcon-<pid>-*.wav`; removed after use or on exit |

Downloads go to `<file>.part` and are renamed only after a size sanity check (1 KB for wake
models, 10 MB for the speaker model), so a truncated file never reaches the ONNX runtime.

In memory: the wake listener and speaker embedder live in refs in `App` for the session; the
speech session lives in a ref in `useTurn` for one turn (plus its tail).

## Depends on / used by

- **Depends on**: `ai` (`transcribe`, `experimental_streamTranscribe`, `generateSpeech`),
  `tui/src/agent/provider.ts` (`resolveTranscription`, `resolveSpeech`),
  `tui/src/agent/hosted.ts` (hosted entries), config (`tui/src/config/paths.ts`, `tui/src/config/persist.ts`), the web gateway
  for hosted audio, external binaries (sox/rec, arecord, ffmpeg, afplay/paplay/aplay/ffplay/play,
  say/espeak-ng/espeak), and `onnxruntime-node` (optional, not in `package.json`; install with
  `bun add onnxruntime-node`).
- **Used by**: `tui/src/ui/app.tsx` (push-to-talk, wake, gate), `tui/src/ui/use-turn.ts`
  (speech, earcons), `tui/src/ui/boot.ts` (voice and voices rows), `tui/src/ui/start.tsx`
  (cleanup on exit), `tui/src/ui/builtin-commands.ts` (`/speak`), `tui/src/index.tsx`
  (`jarvis wake`, `jarvis voice`).

## Gotchas

- **Speaker gate + hosted transcription refuses everything.** The gate needs raw 16 kHz PCM, which
  only the streaming path returns, and hosted transcription forces `voice.stream: false`. With
  `voice.speaker.enabled` on, use your own streaming-capable provider (e.g. `gpt-4o-transcribe`).
- Two capture lists on purpose: `RECORDERS` (`tui/src/ui/voice.ts`, writes a wav file and stops) and
  `STREAMS` (`tui/src/voice/wake.ts`, endless raw PCM on stdout). `voice.recorder` and `voice.capture`
  are not interchangeable. Overrides are taken at their word, no fallback.
- Two PCM conversions that differ by 32768: `pcmToFloat` (wake, raw int16 values; the front end
  normalizes itself) and `pcmToUnit` (speaker, amplitude in [-1, 1]). Swapping them fails
  silently: the wake word never fires, or speaker scores drift (0.974 vs the right answer).
- The wake worker prepends 480 samples of the previous chunk (`MEL_CONTEXT_SAMPLES`); without it
  each chunk loses 3 mel frames and the classifier sees a time-compressed phrase.
- A fresh wake listener is deaf for about 1.9 s while its windows fill.
- No echo cancellation: with `bargeIn` on, a reply that says the wake phrase can wake itself.
- Recorders and capture tools are stopped with SIGINT, not kill, so they flush and finalize.
- `ctrl+s` is XOFF in terminals that keep flow control in raw mode; rebind `keybinds.voice`.
- Earcons and `play` never throw; silence is the failure mode.
- `ponytail:` `pickRecorder` takes the first recorder on PATH, which may not be the mic you
  meant; `voice.recorder` is the escape hatch, and device selection would go there.

## Tests

Run from `tui/`: `bun test test/<file>`.

| Test | Covers |
|---|---|
| `tui/test/dictate.test.ts` | `Transcript`, `canStream`, `dictate` refusals before recording, `encodeWav`, `floatToPcm`, status-line `tail` |
| `tui/test/wake.test.ts` | `detections`, `listenForWake`, `pickStream`, `STREAMS`, `Window`, `pcmToFloat`, `scriptedWakeSource`, `wakeModelPaths` |
| `tui/test/speaker.test.ts` | `cosine`, `centroid`, `enroll`, `forget`, `identify`, `pcmToUnit`, voice store, `capPcm`, `embedder` |
| `tui/test/speak.test.ts` | `nextUtterances`, `speakable`, `pickSynth`, `canSpeak`, `speaking`, `speakAction`, `describeVoice` |
| `tui/test/sound.test.ts` | `pickPlayer`, `synth` |
| `tui/test/ui.test.ts` | `pickRecorder` |
| `tui/test/boot.test.ts` | The voice and voices boot rows |
