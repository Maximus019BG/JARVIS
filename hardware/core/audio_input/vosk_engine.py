"""Vosk speech-to-text engine (optional dependency).

This module intentionally imports `vosk` lazily so the project can run
without Vosk installed.

Vosk expects PCM WAV audio.
"""

from __future__ import annotations

import json

from core.audio_input.stt_base import STTResult, STTEngine


class VoskSTTEngine(STTEngine):
    name = "vosk"

    def __init__(self, model_path: str) -> None:
        if not model_path:
            raise ValueError("Vosk model path is required")

        try:
            from vosk import Model  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "Vosk is not installed. Install it and download a model."
            ) from exc

        self._model = Model(model_path)

    def transcribe_wav_bytes(self, wav_bytes: bytes, *, sample_rate: int) -> STTResult:
        try:
            from vosk import KaldiRecognizer  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("Vosk is not installed") from exc

        rec = KaldiRecognizer(self._model, float(sample_rate))
        # Enable word-level timing if needed later.
        rec.SetWords(False)
        rec.AcceptWaveform(wav_bytes)
        result = json.loads(rec.FinalResult() or "{}")
        text = (result.get("text") or "").strip()

        # Vosk doesn't reliably return confidence; keep field optional.
        return STTResult(text=text, confidence=None, backend=self.name)
