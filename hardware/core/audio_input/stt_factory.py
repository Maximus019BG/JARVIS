"""Factory for creating STT engines based on configuration."""

from __future__ import annotations

from config.config import AudioInputBackend, AudioInputConfig
from core.audio_input.stt_base import STTEngine


class STTEngineFactory:
    @staticmethod
    def create(config: AudioInputConfig) -> STTEngine:
        if config.backend == AudioInputBackend.VOSK:
            if not config.vosk_model_path:
                raise ValueError(
                    "AUDIO_INPUT_VOSK_MODEL_PATH must be set when using backend 'vosk'"
                )
            from core.audio_input.vosk_engine import VoskSTTEngine

            return VoskSTTEngine(model_path=config.vosk_model_path)

        raise ValueError(f"Unsupported audio input backend: {config.backend}")
