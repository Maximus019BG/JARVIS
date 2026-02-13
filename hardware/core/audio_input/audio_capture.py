"""Audio capture utilities.

We keep capture optional and minimal:
- default implementation is a *stub* that raises with clear instructions.
- on Raspberry Pi, users can install an audio backend (e.g., `sounddevice`).

This file is structured so that we can later add:
- ALSA capture
- arecord subprocess capture
- sounddevice capture

without changing the ChatHandler logic.
"""

from __future__ import annotations


class AudioCaptureError(RuntimeError):
    """Raised when microphone audio capture is not available."""


def record_wav_push_to_talk(*, sample_rate: int, max_seconds: int) -> bytes:
    """Record audio from microphone and return WAV bytes.

    Notes:
        - This project intentionally does NOT ship with microphone dependencies.
        - This default stub keeps the core app working even when audio input is disabled.

    Args:
        sample_rate: desired sample rate (e.g., 16000)
        max_seconds: safety cap on recording duration

    Returns:
        WAV file bytes.

    Raises:
        AudioCaptureError: if no capture backend is installed.
    """

    raise AudioCaptureError(
        "Audio capture backend is not installed. "
        "Install a capture dependency (recommended: sounddevice) and enable it in docs."
    )
