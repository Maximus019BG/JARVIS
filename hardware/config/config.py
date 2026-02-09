"""Configuration management for the hardware app.

Uses pydantic-settings for type-safe configuration with environment variable support.
"""

from __future__ import annotations

import os
import re
from enum import Enum
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Annotated

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AIProvider(str, Enum):
    """Supported AI providers."""

    GOOGLE = "google"
    OLLAMA = "ollama"


class TTSEngine(str, Enum):
    """Supported TTS engines."""

    PYTTSX3 = "pyttsx3"
    GTTS = "gtts"
    DISABLED = "disabled"


class SecurityLevel(str, Enum):
    """Security levels for file access and plugins."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AIConfig(BaseSettings):
    """AI provider configuration."""

    model_config = SettingsConfigDict(
        env_prefix="AI_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    provider: AIProvider = AIProvider.GOOGLE

    # Google
    google_api_key: SecretStr | None = None

    # Ollama
    ollama_model: str = "gemma3:1b"
    ollama_host: str = "http://localhost:11434"

    max_tokens: int = 4096
    temperature: float = 0.7

    def validate_provider(self) -> None:
        """Validate provider-specific configuration."""

        if self.provider == AIProvider.GOOGLE:
            key = self.google_api_key.get_secret_value() if self.google_api_key else ""
            if not key:
                # Tests assert this env var name is included in the error.
                raise ValueError("Missing GOOGLE_AI_API_KEY")

        # Ollama requires no API key.


class TTSConfig(BaseSettings):
    """Text-to-speech configuration."""

    model_config = SettingsConfigDict(
        env_prefix="TTS_",
        env_file=".env",
        extra="ignore",
    )

    engine: TTSEngine = TTSEngine.PYTTSX3
    rate: int = 150  # Words per minute for pyttsx3
    volume: float = 1.0  # 0.0 to 1.0
    language: str = "en"


class SecurityConfig(BaseSettings):
    """Security configuration for file access and plugins."""

    model_config = SettingsConfigDict(
        env_prefix="SECURITY_",
        env_file=".env",
        extra="ignore",
        populate_by_name=True,
    )

    level: SecurityLevel = SecurityLevel.HIGH
    allowed_paths_str: str = Field(default="./data,./temp", alias="ALLOWED_PATHS")
    blocked_paths_str: str = Field(
        default="/etc,/sys,/proc,C:\\Windows", alias="BLOCKED_PATHS"
    )
    max_file_size_mb: int = 10
    enable_audit_log: bool = True
    audit_log_path: str = "audit.log"
    # Rate limiting configuration
    rate_limit_max_requests: int = Field(default=100, alias="RATE_LIMIT_MAX_REQUESTS")
    rate_limit_window_seconds: int = Field(
        default=60, alias="RATE_LIMIT_WINDOW_SECONDS"
    )

    @property
    def allowed_paths(self) -> list[str]:
        """Parse allowed paths from comma-separated string."""
        return [p.strip() for p in self.allowed_paths_str.split(",") if p.strip()]

    @property
    def blocked_paths(self) -> list[str]:
        """Parse blocked paths from comma-separated string."""
        return [p.strip() for p in self.blocked_paths_str.split(",") if p.strip()]

    def get_max_file_size_bytes(self) -> int:
        """Return max file size in bytes."""
        return self.max_file_size_mb * 1024 * 1024


class ThemeConfig(BaseSettings):
    """UI theme configuration."""

    model_config = SettingsConfigDict(
        env_prefix="THEME_",
        env_file=".env",
        extra="ignore",
    )

    primary_color: str = "#007bff"
    secondary_color: str = "#6c757d"
    background_color: str = "#ffffff"
    text_color: str = "#000000"
    accent_color: str = "#28a745"


class SyncApiConfig(BaseSettings):
    """Sync API configuration.

    Centralizes server URLs to avoid hardcoding them throughout tools.
    Environment variable support:
      - SYNC_API_BASE_URL
    """

    model_config = SettingsConfigDict(
        env_prefix="SYNC_API_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    base_url: str = Field(default="https://api.jarvis.example.com", alias="BASE_URL")


class AudioInputBackend(str, Enum):
    """Supported speech-to-text (STT) backends for audio input."""

    VOSK = "vosk"


class AudioInputConfig(BaseSettings):
    """Audio input (speech-to-text) configuration.

    Environment variables (all prefixed with AUDIO_INPUT_):
        AUDIO_INPUT_ENABLED: Enable audio input feature
        AUDIO_INPUT_BACKEND: STT backend to use (currently: vosk)
        AUDIO_INPUT_MODE: How audio is captured. Only 'push_to_talk' is supported.
        AUDIO_INPUT_VOSK_MODEL_PATH: Filesystem path to a Vosk model directory
        AUDIO_INPUT_SAMPLE_RATE: Audio capture sample rate
        AUDIO_INPUT_MAX_RECORD_SECONDS: Safety cap for recording duration
    """

    model_config = SettingsConfigDict(
        env_prefix="AUDIO_INPUT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    enabled: bool = Field(default=False, description="Enable audio input (STT)")
    backend: AudioInputBackend = Field(default=AudioInputBackend.VOSK)

    # Keep only push-to-talk initially to protect Pi performance.
    mode: str = Field(default="push_to_talk")

    # Vosk settings
    vosk_model_path: str | None = Field(default=None, alias="VOSK_MODEL_PATH")

    # Audio capture settings (used by the capture backend)
    sample_rate: int = Field(default=16000, ge=8000, le=48000)
    max_record_seconds: int = Field(default=10, ge=1, le=60)

    def validate_mode(self) -> None:
        if self.mode != "push_to_talk":
            raise ValueError(
                f"Unsupported AUDIO_INPUT_MODE={self.mode!r}. Only 'push_to_talk' is supported."
            )


class AppConfig(BaseSettings):
    """Main application configuration aggregating all sub-configs."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "JARVIS Hardware"
    debug: bool = False
    log_level: str = "INFO"
    data_dir: Path = Path("./data")
    # Conversation memory configuration
    conversation_max_messages: int = Field(
        default=50, alias="CONVERSATION_MAX_MESSAGES"
    )
    conversation_recent_messages: int = Field(
        default=10, alias="CONVERSATION_RECENT_MESSAGES"
    )

    # HTTP client connection pooling configuration
    http_max_connections: int = Field(default=100, alias="HTTP_MAX_CONNECTIONS")
    http_max_keepalive: int = Field(default=20, alias="HTTP_MAX_KEEPALIVE")
    http_keepalive_expiry: float = Field(default=5.0, alias="HTTP_KEEPALIVE_EXPIRY")
    http_connect_timeout: float = Field(default=10.0, alias="HTTP_CONNECT_TIMEOUT")
    http_read_timeout: float = Field(default=30.0, alias="HTTP_READ_TIMEOUT")
    http_write_timeout: float = Field(default=10.0, alias="HTTP_WRITE_TIMEOUT")
    http_pool_timeout: float = Field(default=5.0, alias="HTTP_POOL_TIMEOUT")
    http_enable_http2: bool = Field(default=True, alias="HTTP_ENABLE_HTTP2")

    # Path validation cache configuration
    path_validation_cache_size: int = Field(
        default=128, alias="PATH_VALIDATION_CACHE_SIZE"
    )

    # Sub-configurations
    ai: AIConfig = Field(default_factory=AIConfig)
    tts: TTSConfig = Field(default_factory=TTSConfig)
    audio_input: AudioInputConfig = Field(default_factory=AudioInputConfig)
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    theme: ThemeConfig = Field(default_factory=ThemeConfig)
    sync_api: SyncApiConfig = Field(default_factory=SyncApiConfig)

    # Vision / Gesture control (lazy import to avoid circular deps)
    @property
    def vision(self) -> "VisionConfig":
        """Get vision configuration (lazy loaded)."""
        from core.vision.vision_config import VisionConfig

        return VisionConfig()

    def validate_all(self) -> None:
        """Validate all configuration settings."""
        self.ai.validate_provider()
        self.audio_input.validate_mode()
        # Ensure data directory exists
        self.data_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_config() -> AppConfig:
    """Get cached application configuration singleton."""
    return AppConfig()


class ThemeManager:
    """Thread-safe manager for theme state with validation.

    Provides controlled access to theme settings with validation
    and thread-safe operations.
    """

    # Default theme values
    DEFAULT_THEME: dict[str, str] = {
        "primary_color": "#007bff",
        "secondary_color": "#6c757d",
        "background_color": "#ffffff",
        "text_color": "#000000",
        "accent_color": "#28a745",
    }

    # Valid hex color pattern
    HEX_COLOR_PATTERN = re.compile(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$")

    def __init__(self) -> None:
        """Initialize the theme manager with default theme."""
        self._theme: dict[str, str] = self.DEFAULT_THEME.copy()
        self._lock = Lock()

    def get_theme(self) -> dict[str, str]:
        """Get a copy of the current theme.

        Returns:
            A copy of the current theme dictionary.
        """
        with self._lock:
            return self._theme.copy()

    def set_theme(self, theme: dict[str, str]) -> None:
        """Set the theme with validation.

        Args:
            theme: Dictionary of theme settings to apply.

        Raises:
            ValueError: If any color value is invalid.
        """
        # Validate all color values
        for key, value in theme.items():
            if not self._is_valid_color(value):
                raise ValueError(
                    f"Invalid color value for '{key}': {value}. "
                    "Must be a valid hex color (e.g., #007bff or #0f8)."
                )

        with self._lock:
            # Update theme with validated values
            self._theme.update(theme)

            # Ensure all default keys are present
            for key, default_value in self.DEFAULT_THEME.items():
                if key not in self._theme:
                    self._theme[key] = default_value

    def update_theme(self, updates: dict[str, str]) -> None:
        """Update specific theme values with validation.

        Args:
            updates: Dictionary of theme settings to update.

        Raises:
            ValueError: If any color value is invalid.
        """
        self.set_theme(updates)

    def reset_theme(self) -> None:
        """Reset theme to default values."""
        with self._lock:
            self._theme = self.DEFAULT_THEME.copy()

    def get_color(self, key: str) -> str:
        """Get a specific color value.

        Args:
            key: The color key to retrieve.

        Returns:
            The color value, or default if key not found.
        """
        with self._lock:
            return self._theme.get(key, self.DEFAULT_THEME.get(key, "#000000"))

    @classmethod
    def _is_valid_color(cls, color: str) -> bool:
        """Validate a color value.

        Args:
            color: The color string to validate.

        Returns:
            True if the color is valid, False otherwise.
        """
        if not isinstance(color, str):
            return False
        return bool(cls.HEX_COLOR_PATTERN.match(color))


# Global theme manager instance
_theme_manager: ThemeManager | None = None
_theme_lock = Lock()


def get_theme_manager() -> ThemeManager:
    """Get the global theme manager instance (thread-safe singleton)."""
    global _theme_manager
    with _theme_lock:
        if _theme_manager is None:
            _theme_manager = ThemeManager()
        return _theme_manager


# Legacy compatibility - provide backward compatible access
# These functions delegate to the ThemeManager for backward compatibility
def get_current_theme() -> dict[str, str]:
    """Get the current theme (legacy compatibility)."""
    return get_theme_manager().get_theme()


def set_current_theme(theme: dict[str, str]) -> None:
    """Set the current theme (legacy compatibility)."""
    get_theme_manager().set_theme(theme)


# For backward compatibility, expose current_theme as a property-like object
class _ThemeProxy:
    """Proxy object for backward compatibility with current_theme global."""

    def __init__(self) -> None:
        self._manager = get_theme_manager()

    def copy(self) -> dict[str, str]:
        """Return a copy of the current theme."""
        return self._manager.get_theme()

    def update(self, updates: dict[str, str]) -> None:
        """Update the theme with new values."""
        self._manager.update_theme(updates)

    def __getitem__(self, key: str) -> str:
        """Get a theme value by key."""
        return self._manager.get_color(key)

    def __setitem__(self, key: str, value: str) -> None:
        """Set a theme value by key."""
        self._manager.update_theme({key: value})

    def get(self, key: str, default: str | None = None) -> str:
        """Get a theme value with default."""
        try:
            return self._manager.get_color(key)
        except (KeyError, AttributeError):
            return default or "#000000"

    def keys(self) -> list[str]:
        """Get all theme keys."""
        return list(self._manager.get_theme().keys())

    def values(self) -> list[str]:
        """Get all theme values."""
        return list(self._manager.get_theme().values())

    def items(self) -> list[tuple[str, str]]:
        """Get all theme items."""
        return list(self._manager.get_theme().items())


# Create the legacy-compatible proxy
current_theme = _ThemeProxy()
