"""Text-to-Speech engine implementations.

Provides modular TTS support with multiple engine backends:
- pyttsx3: Offline, cross-platform TTS
- gTTS: Google Text-to-Speech (requires internet)
"""

from __future__ import annotations

import asyncio
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING

from app_logging.logger import get_logger

if TYPE_CHECKING:
    from config.config import TTSConfig

logger = get_logger(__name__)


class TTSError(Exception):
    """Raised when TTS operations fail."""


class TTSEngine(ABC):
    """Abstract base class for TTS engines."""

    @abstractmethod
    async def speak(self, text: str) -> None:
        """Speak the given text.

        Args:
            text: Text to convert to speech.
        """

    @abstractmethod
    def speak_sync(self, text: str) -> None:
        """Synchronous version of speak.

        Args:
            text: Text to convert to speech.
        """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the engine name."""

    def is_available(self) -> bool:
        """Check if the engine is available."""
        return True


class PyTTSX3Engine(TTSEngine):
    """Offline TTS using pyttsx3.

    Works on Windows, macOS, and Linux without internet.
    """

    def __init__(self, rate: int = 150, volume: float = 1.0) -> None:
        self._engine = None
        self._rate = rate
        self._volume = volume
        self._available = False
        self._init_engine()

    def _init_engine(self) -> None:
        """Initialize the pyttsx3 engine."""
        try:
            import pyttsx3

            self._engine = pyttsx3.init()
            self._engine.setProperty("rate", self._rate)
            self._engine.setProperty("volume", self._volume)
            self._available = True
            logger.info("pyttsx3 engine initialized successfully")
        except Exception as e:
            logger.warning("Failed to initialize pyttsx3: %s", e)
            self._available = False

    @property
    def name(self) -> str:
        return "pyttsx3"

    def is_available(self) -> bool:
        return self._available and self._engine is not None

    def speak_sync(self, text: str) -> None:
        """Speak text synchronously."""
        if not self.is_available():
            raise TTSError("pyttsx3 engine not available")

        try:
            self._engine.say(text)
            self._engine.runAndWait()
        except Exception as e:
            raise TTSError(f"pyttsx3 speak failed: {e}") from e

    async def speak(self, text: str) -> None:
        """Speak text asynchronously.

        Note: pyttsx3 is synchronous, so we run it in a thread pool.
        """
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self.speak_sync, text)


class GTTSEngine(TTSEngine):
    """Google Text-to-Speech engine.

    Requires internet connection. Uses pygame for audio playback.
    """

    def __init__(self, language: str = "en", slow: bool = False) -> None:
        self._language = language
        self._slow = slow
        self._available = False
        self._pygame_initialized = False
        self._check_availability()

    def _check_availability(self) -> None:
        """Check if gTTS and pygame are available."""
        try:
            import pygame
            from gtts import gTTS  # noqa: F401

            self._gTTS = gTTS
            self._pygame = pygame
            self._available = True
            logger.info("gTTS engine available")
        except ImportError as e:
            logger.warning("gTTS not available: %s", e)
            self._available = False

    def _init_pygame(self) -> None:
        """Initialize pygame mixer if needed."""
        if not self._pygame_initialized:
            try:
                self._pygame.mixer.init()
                self._pygame_initialized = True
            except Exception as e:
                raise TTSError(f"Failed to initialize pygame mixer: {e}") from e

    @property
    def name(self) -> str:
        return "gtts"

    def is_available(self) -> bool:
        return self._available

    def speak_sync(self, text: str) -> None:
        """Speak text synchronously."""
        if not self.is_available():
            raise TTSError("gTTS engine not available")

        self._init_pygame()

        # Create temp file for audio
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as temp_file:
            temp_path = Path(temp_file.name)

        try:
            # Generate speech
            tts = self._gTTS(text=text, lang=self._language, slow=self._slow)
            tts.save(str(temp_path))

            # Play audio
            self._pygame.mixer.music.load(str(temp_path))
            self._pygame.mixer.music.play()

            # Wait for playback to complete
            while self._pygame.mixer.music.get_busy():
                self._pygame.time.wait(100)

        except Exception as e:
            raise TTSError(f"gTTS speak failed: {e}") from e
        finally:
            # Cleanup temp file
            try:
                self._pygame.mixer.music.unload()
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass

    async def speak(self, text: str) -> None:
        """Speak text asynchronously."""
        if not self.is_available():
            raise TTSError("gTTS engine not available")

        self._init_pygame()

        # Create temp file for audio
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as temp_file:
            temp_path = Path(temp_file.name)

        try:
            # Generate speech in thread pool (network I/O)
            loop = asyncio.get_event_loop()
            tts = self._gTTS(text=text, lang=self._language, slow=self._slow)
            await loop.run_in_executor(None, tts.save, str(temp_path))

            # Play audio
            self._pygame.mixer.music.load(str(temp_path))
            self._pygame.mixer.music.play()

            # Wait for playback to complete asynchronously
            while self._pygame.mixer.music.get_busy():
                await asyncio.sleep(0.1)

        except Exception as e:
            raise TTSError(f"gTTS speak failed: {e}") from e
        finally:
            # Cleanup temp file
            try:
                self._pygame.mixer.music.unload()
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass


class DisabledTTSEngine(TTSEngine):
    """A no-op TTS engine when TTS is disabled."""

    @property
    def name(self) -> str:
        return "disabled"

    def is_available(self) -> bool:
        return True

    def speak_sync(self, text: str) -> None:
        """No-op."""
        logger.debug("TTS disabled, not speaking: %s", text[:50])

    async def speak(self, text: str) -> None:
        """No-op."""
        logger.debug("TTS disabled, not speaking: %s", text[:50])


class TTSEngineFactory:
    """Factory for creating TTS engine instances."""

    @staticmethod
    def create(config: TTSConfig | None = None) -> TTSEngine:
        """Create a TTS engine based on configuration.

        Args:
            config: TTS configuration. If None, uses defaults.

        Returns:
            A TTS engine instance.
        """
        from config.config import TTSConfig
        from config.config import TTSEngine as TTSEngineEnum

        if config is None:
            config = TTSConfig()

        engine_type = config.engine

        if engine_type == TTSEngineEnum.DISABLED:
            return DisabledTTSEngine()
        elif engine_type == TTSEngineEnum.GTTS:
            engine = GTTSEngine(language=config.language)
            if engine.is_available():
                return engine
            logger.warning("gTTS not available, falling back to pyttsx3")
            return TTSEngineFactory._create_pyttsx3(config)
        else:  # Default to pyttsx3
            return TTSEngineFactory._create_pyttsx3(config)

    @staticmethod
    def _create_pyttsx3(config: TTSConfig) -> TTSEngine:
        """Create pyttsx3 engine with fallback to disabled."""
        engine = PyTTSX3Engine(rate=config.rate, volume=config.volume)
        if engine.is_available():
            return engine

        logger.warning("pyttsx3 not available, TTS disabled")
        return DisabledTTSEngine()

    @staticmethod
    def create_with_fallback() -> TTSEngine:
        """Create a TTS engine with automatic fallback chain.

        Tries: pyttsx3 -> gTTS -> disabled
        """
        # Try pyttsx3 first (offline)
        pyttsx3_engine = PyTTSX3Engine()
        if pyttsx3_engine.is_available():
            return pyttsx3_engine

        # Try gTTS (online)
        gtts_engine = GTTSEngine()
        if gtts_engine.is_available():
            return gtts_engine

        # Fallback to disabled
        logger.warning("No TTS engine available, TTS disabled")
        return DisabledTTSEngine()
