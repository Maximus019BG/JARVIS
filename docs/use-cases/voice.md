# Voice

Modules: [tui/voice](../modules/tui/voice/README.md), [mobile](../modules/mobile/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why

A user who would rather talk than type. In the terminal they dictate a prompt, wake JARVIS by name,
hear the answer read aloud, and get a tone when a long turn ends. An optional speaker check refuses
voices that are not enrolled. Away from the desk, the phone app turns speech into text and queues
it as a prompt for the terminal. In every path the words land as editable text first. Nothing is sent
or run until the user says so.

## Flow

1. **Pick who transcribes.** On a paired device nothing needs setting up. At startup
   `tui/src/agent/hosted.ts` → `withHostedFallback` adds two in-memory providers, `jarvis-voice` and
   `jarvis-speech`, with the device token as the API key. They are never written to config. If
   `voice.model` is unset, transcription uses `jarvis-voice/whisper-large-v3-turbo` with
   `voice.stream` forced to `false`, because the gateway has no realtime socket. If
   `voice.speakModel` is unset, speech uses `jarvis-speech/canopylabs/orpheus-v1-english`. A user's
   own key (`/voice` opens the wizard, for example Groq or OpenAI) replaces the hosted transcription.
   With no `voice.model` at all, pressing the mic opens that wizard instead of failing.
2. **Start recording.** ctrl+s (`voice` keybind), the mic button in the prompt, the wake word or the
   `call` hand gesture call `tui/src/ui/app.tsx` → `toggleVoice`. The first press stops any reply being
   spoken (barge-in), then starts one of two capture paths:
   - **Streaming dictation** (`tui/src/voice/dictate.ts` → `dictate`), when `voice.stream` is not false
     and the model can stream. Raw 16 kHz mono PCM goes to the provider as the user speaks. The partial
     text shows in the status line.
   - **Push-to-talk** (`tui/src/ui/voice.ts` → `listen`), when the model "cannot stream". A recorder
     writes a temp wav, which is transcribed in one call after stop.
3. **Stop.** The second press stops capture. Streaming keeps a copy of every chunk. If the stream
   fails or returns nothing, that buffer is sent as one wav, so a dropped socket loses nothing.
   Escape cancels without transcribing.
4. **Speaker gate** (optional, `voice.speaker.enabled`). `gateVoice` embeds the recording with a local
   WavLM model and compares it with the voices in `voices.json`. A match lets the text through.
   Anything else refuses with the best score and the bar.
5. **Insert.** The text is inserted into the prompt, never submitted. The user reads it, edits it,
   then presses enter.
6. **Hosted transcription** (when hosted). `POST /api/gateway/v1/audio/transcriptions` checks the
   device token and the gateway limits, then forwards the multipart body to Groq Whisper on the
   server's key. The cost is estimated per minute from the file size and metered like any gateway call
   ([Model calls and usage](model-calls-and-usage.md)).
7. **Wake word** (optional, `voice.wake.enabled`). After `jarvis wake models` downloads the
   openWakeWord models, a worker process listens to the microphone and scores every 80 ms chunk
   locally. When the score passes `threshold` for `frames` chunks in a row, it plays the `attention`
   earcon and starts recording, exactly as ctrl+s would. Audio leaves the machine only after the
   phrase fires, and only for transcription. The listener pauses while recording. While a reply is
   spoken it keeps listening (so the phrase interrupts the reply), unless `bargeIn` is false.
8. **Enrol a voice** (for the gate). `jarvis voice models` downloads the speaker model.
   `jarvis voice enrol <name>` records 3 clips of 4 s, stores their average embedding, and prints how
   well the clips agree. `jarvis voice test` prints every enrolled voice's score against the
   threshold. `jarvis voice list` and `jarvis voice forget <name>` manage the store.
9. **Speak the answer** (`/speak on`, or `voice.speak`). `tui/src/ui/speak.ts` → `speaking` takes each
   top-level text delta of a turn, splits it into whole sentences, and strips markdown, code blocks and
   link URLs. Synthesis runs one sentence ahead of playback. It uses the hosted or own-key speech model
   when `voice.speakModel` is set, and otherwise a local synth (`say`, `espeak-ng`, `espeak`, or
   `voice.synth` for piper). Subagent text is not spoken. Interrupt or a new recording stops it.
10. **Earcons** (`sound.earcons`). Three generated tones. `attention` plays when a permission prompt
    opens or the wake word fires. `ack` or `fail` plays when a turn of at least `sound.afterSeconds`
    ends, unless the user interrupted it or the answer was spoken.
11. **Talk from the phone** (`mobile/app/talk.tsx` → `Talk`). From a session in the app, the user holds
    the talk button. The platform's speech recognizer (`en-US`, interim results) fills an editable text
    box. Only text reaches the JARVIS server: the app never uploads audio. Send calls
    `POST /api/session/{id}/prompt`, which queues the prompt for that session. The terminal picks it up
    only with `remoteSteering` on: it polls every 5 s while idle and sends the prompt through the normal
    permission gate ([Remote approval and steering](remote-approval-and-steering.md)).

## Business rules

| Rule | Value | Source |
|---|---|---|
| Hosted voice | only on a paired device; providers built in memory, token never persisted | `tui/src/agent/hosted.ts` |
| Hosted dictation | always push-to-talk (`voice.stream: false`) | `tui/src/agent/hosted.ts` → `withHostedFallback` |
| Transcription models (hosted) | `whisper-large-v3-turbo`, `whisper-large-v3`; anything else → 404 | `web/src/server/gateway/upstreams.ts` → `AUDIO` |
| Audio upload | at most 10 MB, matching nginx's body cap (413 above) | same → `maxAudioBytes` |
| Speech request (hosted) | 1–4096 characters; unknown voices become `troy`; answer is wav | same → `maxSpeechChars`, `defaultVoice` |
| Gateway limits | 60 requests a minute per device; $20 per user per calendar month | `web/src/server/gateway/upstreams.ts` → `LIMITS` |
| Upstream timeout | 60 s per audio call (504) | same → `AUDIO.timeoutMs` |
| Stream close wait | at most 5 s after stop | `tui/src/voice/dictate.ts` → `FINISH_TIMEOUT_MS` |
| Stray keypress | under 2048 bytes of audio is not re-transcribed | `tui/src/voice/dictate.ts` |
| Wake defaults | phrase `hey_jarvis`, threshold 0.5, 2 frames of 80 ms, refractory 2000 ms, barge-in on | `tui/src/config/config.ts` |
| Speaker gate | threshold 0.86; fails closed; clips under 1 s refused, over 4 s cut to the middle 4 s | `tui/src/config/config.ts`, `tui/src/voice/embedder.ts` |
| Enrolment | 3 clips × 4 s | `tui/src/cli/voice.ts` |
| Earcons | off by default; `ack` 880 Hz, `attention` 660→990 Hz, `fail` 660→440 Hz; `afterSeconds` 20 | `tui/src/ui/sound.ts` |
| Phone prompt | 1–8000 characters; owner only; at most 10 pending per session (429) | `web/src/app/api/session/[sessionId]/prompt/route.ts` |

**Local data.** `voices.json` (mode 0600) in the data dir holds one embedding per enrolled name, never
audio. Recordings, speech clips and earcons are temp files, deleted after use or on exit. Wake and
speaker models live under the data dir's `models/` folder.

**The speaker gate is a convenience, not authentication.** A recording of the user defeats it, and it
does not replace the permission gate. It decides whose words become a prompt, not what the agent may do.

## When it fails

- **Speaker gate on with hosted transcription.** Every utterance is refused ("this recording is not raw
  16 kHz audio"), because only streaming returns PCM. Use your own streaming-capable provider.
- **Nobody enrolled.** The gate refuses with "run `jarvis voice enrol <name>`".
- **No recorder or capture tool on PATH.** The error names what is missing. Set `voice.recorder` or
  `voice.capture`. Overrides are used as given, with no fallback.
- **No sound.** Earcons never throw: a missing player means silence. Set `sound.player`.
- **Wake models missing.** One error note at startup: "run `jarvis wake models`".
- **"heard nothing".** The transcription was empty. Nothing is inserted.
- **Hosted audio errors.** 401 (device revoked), 429 (rate or monthly budget), 503 (gateway disabled
  or no voice key on the server), 502/504 (upstream). The TUI shows the error as a note.
- **Speech errors.** Reported once per turn as a `voice: …` note. The turn itself still completes.
- **ctrl+s does nothing.** Some terminals treat it as XOFF. Rebind `keybinds.voice`.
- **Phone.** Mic or speech permission denied shows a message. A 429 means the terminal has not picked
  up 10 earlier prompts yet. A prompt waits until a terminal with `remoteSteering` on is idle on that session.

## Related

- [Remote approval and steering](remote-approval-and-steering.md): how a queued phone prompt reaches the terminal.
- [Model calls and usage](model-calls-and-usage.md): the gateway's metering and limits.
- [Hand gestures and drawing](hand-gestures-and-drawing.md): the `call` gesture toggles recording.
- [Install and setup](install-and-setup.md): pairing and the provider wizard on first run.
- Module docs: [tui/voice](../modules/tui/voice/README.md), [mobile](../modules/mobile/README.md),
  [web/gateway](../modules/web/gateway/README.md).
