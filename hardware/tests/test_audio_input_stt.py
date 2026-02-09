"""Tests for optional audio input STT plumbing.

These tests do NOT require vosk to be installed.
We validate:
- config parsing and validation
- factory wiring for Vosk
- manager behavior on capture error
- Vosk engine lazy-import failure message
"""

from __future__ import annotations

import pytest

from config.config import AudioInputBackend, AudioInputConfig


def test_audio_input_config_defaults_disabled() -> None:
    cfg = AudioInputConfig(_env_file=None)
    assert cfg.enabled is False
    assert cfg.backend == AudioInputBackend.VOSK
    assert cfg.mode == "push_to_talk"


def test_audio_input_config_rejects_unknown_mode() -> None:
    cfg = AudioInputConfig(mode="always_listening", _env_file=None)
    with pytest.raises(ValueError, match="AUDIO_INPUT_MODE"):
        cfg.validate_mode()


def test_factory_requires_vosk_model_path() -> None:
    from core.audio_input.stt_factory import STTEngineFactory

    cfg = AudioInputConfig(
        enabled=True,
        backend=AudioInputBackend.VOSK,
        vosk_model_path=None,
        _env_file=None,
    )

    with pytest.raises(ValueError, match="AUDIO_INPUT_VOSK_MODEL_PATH"):
        STTEngineFactory.create(cfg)


def test_audio_input_manager_returns_error_on_capture_failure(monkeypatch) -> None:
    from core.audio_input.audio_input_manager import AudioInputManager

    cfg = AudioInputConfig(
        enabled=True,
        backend=AudioInputBackend.VOSK,
        vosk_model_path="/tmp/fake-model",
        _env_file=None,
    )

    class _DummyEngine:
        name = "dummy"

        def transcribe_wav_bytes(self, wav_bytes: bytes, *, sample_rate: int):
            raise AssertionError("transcribe should not be called when capture fails")

    monkeypatch.setattr(
        "core.audio_input.audio_input_manager.STTEngineFactory.create",
        lambda _cfg: _DummyEngine(),
        raising=True,
    )

    from core.audio_input import audio_input_manager as mod

    class _Err(mod.AudioCaptureError):
        pass

    def _raise_capture(*, sample_rate: int, max_seconds: int) -> bytes:
        raise _Err("no mic")

    monkeypatch.setattr(mod, "record_wav_push_to_talk", _raise_capture, raising=True)

    mgr = AudioInputManager(cfg)
    outcome = mgr.capture_and_transcribe()
    assert outcome.ok is False
    assert "no mic" in (outcome.error or "")


def test_vosk_engine_raises_clear_error_when_vosk_missing() -> None:
    from core.audio_input.vosk_engine import VoskSTTEngine

    with pytest.raises(RuntimeError, match="Vosk is not installed"):
        VoskSTTEngine(model_path="/tmp/fake-model")
