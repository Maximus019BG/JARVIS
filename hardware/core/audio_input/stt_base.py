"""Speech-to-text (STT) abstractions for optional audio input.

Design goals:
- Keep dependencies optional (imported only if feature enabled).
- Keep capture/transcription pluggable.
- Support Raspberry Pi constraints by focusing on push-to-talk.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class STTResult:
    """Result of a speech-to-text transcription."""

    text: str
    confidence: float | None = None
    backend: str = "unknown"


class STTEngine:
    """Interface for offline/online STT engines."""

    name: str = "base"

    def transcribe_wav_bytes(self, wav_bytes: bytes, *, sample_rate: int) -> STTResult:
        """Transcribe a WAV payload into text.

        Args:
            wav_bytes: WAV file bytes (RIFF/WAVE).
            sample_rate: Sample rate of the audio.

        Returns:
            STTResult with recognized text.
        """

        raise NotImplementedError
