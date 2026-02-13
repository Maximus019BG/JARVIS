# Audio Input (Speech-to-Text) with Vosk (Offline)

This project supports **optional** offline audio input (speech-to-text) using **Vosk**.

The code is dependency-optional: if you don’t enable audio input in your `.env`, the app will run without Vosk.

## 1) Install system dependencies (Raspberry Pi OS Lite)

```bash
sudo apt-get update
sudo apt-get install -y \
  python3-dev \
  portaudio19-dev \
  libasound2-dev \
  build-essential
```

Notes:
- `portaudio19-dev` is commonly needed for microphone capture libraries.
- If you use USB mic, ensure it shows in `arecord -l`.

## 2) Add python dependencies using `uv`

From the `hardware/` directory:

```bash
uv add vosk
```

For microphone capture you have options:

### Option A (recommended): `sounddevice`

```bash
uv add sounddevice
```

### Option B: `pyaudio`

```bash
uv add pyaudio
```

If `pyaudio` fails to build, install extra deps:

```bash
sudo apt-get install -y portaudio19-dev
```

## 3) Download a Vosk model

Create a directory to store models:

```bash
mkdir -p ./data/models
```

Download a small English model (example):

```bash
cd ./data/models
wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
```

You should end up with a directory like:

- `./data/models/vosk-model-small-en-us-0.15/`

## 4) Configure `.env`

Copy the example file:

```bash
cp .env.example .env
```

Set:

```ini
AUDIO_INPUT_ENABLED=true
AUDIO_INPUT_BACKEND=vosk
AUDIO_INPUT_MODE=push_to_talk
AUDIO_INPUT_VOSK_MODEL_PATH=./data/models/vosk-model-small-en-us-0.15
AUDIO_INPUT_SAMPLE_RATE=16000
AUDIO_INPUT_MAX_RECORD_SECONDS=10
```

## 5) Use in the chat

In the chat prompt, type:

- `/mic`

The assistant will attempt to record a short clip and transcribe it.

## Implementation notes / current status

- STT engine is implemented via [`core.audio_input.vosk_engine.VoskSTTEngine()`](../core/audio_input/vosk_engine.py).
- Capture is currently a stub in [`core.audio_input.audio_capture.record_wav_push_to_talk()`](../core/audio_input/audio_capture.py) and must be implemented for your chosen capture library.

Recommended next step:
- Implement `sounddevice` capture that returns WAV bytes, guarded behind optional imports.
