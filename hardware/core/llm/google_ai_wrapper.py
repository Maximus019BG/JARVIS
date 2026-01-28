"""Google AI (google-generativeai) provider wrapper.

This module is intentionally lightweight so tests can patch:
- `hardware.core.llm.google_ai_wrapper.genai`
- `hardware.core.llm.google_ai_wrapper.GOOGLE_AI_AVAILABLE`

The production dependency (`google-generativeai`) is optional.
"""

from __future__ import annotations

from typing import Any

from app_logging.logger import get_logger

logger = get_logger(__name__)

try:
    import google.generativeai as genai  # type: ignore

    GOOGLE_AI_AVAILABLE = True
except Exception:  # pragma: no cover
    genai = None  # type: ignore
    GOOGLE_AI_AVAILABLE = False


class GoogleAIWrapper:
    """Minimal Google AI provider wrapper.

    Note: The current unit tests only validate that the factory can construct a
    provider when an API key exists and GOOGLE_AI_AVAILABLE is True.
    """

    def __init__(
        self,
        api_key: str,
        model_name: str = "gemini-1.5-flash",
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> None:
        if not GOOGLE_AI_AVAILABLE or genai is None:
            raise ValueError(
                "Google AI provider is not available. Install google-generativeai."
            )

        if not api_key:
            raise ValueError("Missing GOOGLE_AI_API_KEY")

        # Configure client.
        genai.configure(api_key=api_key)

        self._model_name = model_name
        self._temperature = temperature
        self._max_tokens = max_tokens

        # Keep a reference for potential future calls.
        # (Tests patch `genai.types.GenerationConfig`.)
        self._generation_config = genai.types.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_tokens,
        )

    def chat_with_tools(
        self,
        message: str,
        tools: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError(
            "GoogleAIWrapper.chat_with_tools is not implemented in this repo yet."
        )

    def continue_conversation(
        self,
        tool_results: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> str:
        raise NotImplementedError(
            "GoogleAIWrapper.continue_conversation is not implemented in this repo yet."
        )
