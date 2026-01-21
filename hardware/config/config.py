"""Configuration management for the hardware app.

Uses pydantic-settings for type-safe configuration with environment variable support.
"""

from __future__ import annotations

import os
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, SecretStr, field_validator
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
    google_api_key: SecretStr | None = Field(default=None, alias="GOOGLE_AI_API_KEY")
    google_model: str = "gemini-2.0-flash"
    ollama_model: str = "llama3.2:3b"
    ollama_host: str = "http://localhost:11434"
    max_tokens: int = 4096
    temperature: float = 0.7

    @field_validator("google_api_key", mode="before")
    @classmethod
    def load_google_key_from_env(cls, v: str | None) -> str | None:
        """Load Google API key from environment if not set."""
        return v or os.getenv("GOOGLE_AI_API_KEY")

    def validate_provider(self) -> None:
        """Validate that required API keys are present for the chosen provider."""
        if self.provider == AIProvider.GOOGLE and not self.google_api_key:
            raise ValueError(
                "GOOGLE_AI_API_KEY environment variable required for Google AI provider"
            )


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

    # Sub-configurations
    ai: AIConfig = Field(default_factory=AIConfig)
    tts: TTSConfig = Field(default_factory=TTSConfig)
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    theme: ThemeConfig = Field(default_factory=ThemeConfig)

    def validate_all(self) -> None:
        """Validate all configuration settings."""
        self.ai.validate_provider()
        # Ensure data directory exists
        self.data_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_config() -> AppConfig:
    """Get cached application configuration singleton."""
    return AppConfig()


# Legacy compatibility
DEFAULT_THEME: dict[str, str] = {
    "primary_color": "#007bff",
    "secondary_color": "#6c757d",
    "background_color": "#ffffff",
    "text_color": "#000000",
    "accent_color": "#28a745",
}

current_theme = DEFAULT_THEME.copy()
