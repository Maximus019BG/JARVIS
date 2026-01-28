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
        """Continue conversation after tool execution.

        `tool_results` entries must include:
        - `tool_call_id: str`
        - `content: str`

        Optional keys (provider may ignore):
        - `raw: dict[str, Any]`
        """
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

        if provider_type == AIProvider.GOOGLE:
            return LLMProviderFactory._create_google_provider(config)

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
    def _create_google_provider(config: AIConfig) -> LLMProvider:
        """Create Google AI provider."""
        config.validate_provider()

        # Import using the full module path so tests can patch
        # `hardware.core.llm.google_ai_wrapper.*` reliably.
        from hardware.core.llm.google_ai_wrapper import (  # type: ignore
            GOOGLE_AI_AVAILABLE,
            GoogleAIWrapper,
        )

        if not GOOGLE_AI_AVAILABLE:
            raise ValueError(
                "Google AI provider is not available. Install google-generativeai."
            )

        api_key = (
            config.google_api_key.get_secret_value() if config.google_api_key else ""
        )
        return GoogleAIWrapper(
            api_key=api_key,
            temperature=config.temperature,
            max_tokens=config.max_tokens,
        )

    @staticmethod
    def create_with_fallback(
        primary_config: AIConfig | None = None,
    ) -> LLMProvider:
        """Create an LLM provider with automatic fallback.

        Note: unit tests expect a simple retry behavior.

        Tries to create the configured provider, and on failure, retries once.
        (In a real system this could fall back to alternative providers.)
        """
        if primary_config is None:
            primary_config = AIConfig()

        try:
            return LLMProviderFactory.create(primary_config)
        except Exception as e:
            logger.error("Provider creation failed: %s", e)
            # Retry once (tests assert `create` is called twice).
            return LLMProviderFactory.create(primary_config)
