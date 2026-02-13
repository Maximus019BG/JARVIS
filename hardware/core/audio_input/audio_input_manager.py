"""Audio input manager.

Provides a single entrypoint for "get me a user utterance" when audio input is
enabled.

Currently implemented:
- push-to-talk: record a short clip, transcribe with configured backend.

Audio capture is intentionally stubbed by default to avoid adding heavy deps.
"""

from __future__ import annotations

from dataclasses import dataclass

from app_logging.logger import get_logger
from config.config import AudioInputConfig
from core.audio_input.audio_capture import AudioCaptureError, record_wav_push_to_talk
from core.audio_input.stt_factory import STTEngineFactory

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class AudioInputOutcome:
    ok: bool
    text: str
    error: str | None = None


class AudioInputManager:
    def __init__(self, config: AudioInputConfig) -> None:
        self._config = config
        self._engine = STTEngineFactory.create(config)

    def capture_and_transcribe(self) -> AudioInputOutcome:
        """Record audio (push-to-talk) and return transcript."""

        try:
            wav_bytes = record_wav_push_to_talk(
                sample_rate=self._config.sample_rate,
                max_seconds=self._config.max_record_seconds,
            )
        except AudioCaptureError as exc:
            return AudioInputOutcome(ok=False, text="", error=str(exc))
        except Exception as exc:
            logger.exception("Audio capture failed")
            return AudioInputOutcome(ok=False, text="", error=f"Audio capture failed: {exc}")

        try:
            result = self._engine.transcribe_wav_bytes(
                wav_bytes, sample_rate=self._config.sample_rate
            )
            return AudioInputOutcome(ok=True, text=result.text)
        except Exception as exc:
            logger.exception("STT transcription failed")
            return AudioInputOutcome(ok=False, text="", error=f"STT failed: {exc}")
