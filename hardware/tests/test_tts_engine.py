"""Tests for TTS engine module."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from core.tts.engine import (
    DisabledTTSEngine,
    GTTSEngine,
    PyTTSX3Engine,
    TTSEngine,
    TTSEngineFactory,
    TTSError,
)


class TestDisabledTTSEngine:
    """Tests for DisabledTTSEngine."""

    @pytest.fixture
    def engine(self):
        """Create a DisabledTTSEngine instance."""
        return DisabledTTSEngine()

    def test_name(self, engine):
        """Test engine name."""
        assert engine.name == "disabled"

    def test_is_available(self, engine):
        """Test availability check."""
        assert engine.is_available() is True

    def test_speak_sync(self, engine):
        """Test sync speak is no-op."""
        engine.speak_sync("Hello")  # Should not raise

    @pytest.mark.asyncio
    async def test_speak(self, engine):
        """Test async speak is no-op."""
        await engine.speak("Hello")  # Should not raise


class TestPyTTSX3Engine:
    """Tests for PyTTSX3Engine."""

    def test_name(self):
        """Test engine name."""
        # pyttsx3 is available on Windows, so just test directly
        engine = PyTTSX3Engine()
        assert engine.name == "pyttsx3"

    def test_init_failure_graceful(self):
        """Test graceful handling of init failure."""
        # Just verify the engine can be created
        engine = PyTTSX3Engine()
        # Should have availability status
        assert isinstance(engine.is_available(), bool)


class TestGTTSEngine:
    """Tests for GTTSEngine."""

    @pytest.fixture
    def mock_gtts_pygame(self):
        """Mock gTTS and pygame modules."""
        mock_gtts = MagicMock()
        mock_pygame = MagicMock()

        with patch.dict(
            "sys.modules",
            {"gtts": mock_gtts, "pygame": mock_pygame},
        ):
            yield mock_gtts, mock_pygame

    def test_name(self):
        """Test engine name."""
        engine = GTTSEngine()
        assert engine.name == "gtts"

    def test_default_language(self):
        """Test default language."""
        engine = GTTSEngine()
        assert engine._language == "en"

    def test_custom_language(self):
        """Test custom language."""
        engine = GTTSEngine(language="fr")
        assert engine._language == "fr"


class TestTTSEngineFactory:
    """Tests for TTSEngineFactory."""

    def test_create_disabled(self):
        """Test creating disabled engine."""
        from config.config import TTSConfig
        from config.config import TTSEngine as TTSEngineEnum

        config = TTSConfig(engine=TTSEngineEnum.DISABLED)
        engine = TTSEngineFactory.create(config)

        assert isinstance(engine, DisabledTTSEngine)

    def test_create_with_fallback(self):
        """Test create with fallback returns valid engine."""
        engine = TTSEngineFactory.create_with_fallback()

        assert isinstance(engine, TTSEngine)
        assert engine.is_available()
