"""Factory for creating LLM provider instances.

Supports dynamic provider selection based on configuration with fallback support.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

from app_logging.logger import get_logger
from config.config import AIConfig, AIProvider

if TYPE_CHECKING:
    from typing import Any

logger = get_logger(__name__)


@runtime_checkable
class LLMProvider(Protocol):
    """Protocol defining the interface for LLM providers."""

    def chat_with_tools(
        self,
        message: str,
        tools: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Send a message with tool capabilities."""
        ...

    def continue_conversation(
        self,
        tool_results: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> str:
        """Continue conversation after tool execution."""
        ...


class LLMProviderFactory:
    """Factory for creating LLM provider instances."""

    @staticmethod
    def create(config: AIConfig | None = None) -> LLMProvider:
        """Create an LLM provider based on configuration.

        Args:
            config: AI configuration. If None, loads from environment.

        Returns:
            An LLM provider instance.

        Raises:
            ValueError: If the provider cannot be created.
        """
        if config is None:
            config = AIConfig()

        provider_type = config.provider

        if provider_type == AIProvider.OLLAMA:
            return LLMProviderFactory._create_ollama_provider(config)
        else:
            raise ValueError(f"Unknown AI provider: {provider_type}")

    @staticmethod
    def _create_ollama_provider(config: AIConfig) -> LLMProvider:
        """Create Ollama provider."""
        from core.llm.llama_wrapper import (
            OLLAMA_AVAILABLE,
            LlamaWrapper,
        )

        if not OLLAMA_AVAILABLE:
            raise ValueError(
                "No LLM provider available. Install ollama or google-generativeai."
            )

        return LlamaWrapper(model_name=config.ollama_model)

    @staticmethod
    def create_with_fallback(
        primary_config: AIConfig | None = None,
    ) -> LLMProvider:
        """Create an LLM provider with automatic fallback.

        Tries to create the configured provider, falls back to alternatives
        if the primary fails.

        Args:
            primary_config: Primary AI configuration.

        Returns:
            An LLM provider instance.
        """
        if primary_config is None:
            primary_config = AIConfig()

        try:
            return LLMProviderFactory.create(primary_config)
        except Exception as e:
            logger.error("Provider creation failed: %s", e)
            raise
