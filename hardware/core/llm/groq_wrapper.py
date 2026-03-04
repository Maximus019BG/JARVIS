"""Groq API wrapper for JARVIS.

Uses the Groq Python SDK (OpenAI-compatible) for fast cloud inference
with tool-calling support. Free tier: generous rate limits on Llama 3 models.

Docs: https://console.groq.com/docs/tool-use
"""

from __future__ import annotations

import json
import logging
from typing import Any

try:
    from groq import AsyncGroq

    GROQ_AVAILABLE = True
except ImportError:
    AsyncGroq = None  # type: ignore
    GROQ_AVAILABLE = False

logger = logging.getLogger(__name__)


def _convert_tool_schema_to_openai(tool: dict[str, Any]) -> dict[str, Any]:
    """Convert Ollama-style tool schema to OpenAI/Groq format.

    Ollama format (what our tools produce):
        {"type": "function", "function": {"name": ..., "description": ..., "parameters": ...}}

    OpenAI/Groq format (what the API expects):
        {"type": "function", "function": {"name": ..., "description": ..., "parameters": ...}}

    They are actually the same shape, but we ensure consistency here.
    """
    # Our tool schemas already use the OpenAI format, so just pass through
    return tool


def _convert_tool_calls_to_ollama_format(
    tool_calls: list[Any],
) -> list[dict[str, Any]]:
    """Convert Groq/OpenAI tool call objects to the dict format chat_handler expects.

    Expected output format (matches Ollama):
        {"id": "...", "function": {"name": "...", "arguments": "..."}}
    """
    result = []
    for tc in tool_calls:
        entry: dict[str, Any] = {
            "id": tc.id,
            "type": "function",
            "function": {
                "name": tc.function.name,
                "arguments": tc.function.arguments,  # JSON string
            },
        }
        result.append(entry)
    return result


class GroqWrapper:
    """Wrapper for interacting with Groq's API (Llama 3, Mixtral, etc.).

    Automatically falls back to alternate free-tier models when rate-limited.
    """

    # Groq free-tier models to try in order when rate-limited.
    # Each model has its own independent rate limit on the free tier.
    FALLBACK_MODELS: list[str] = [
        "llama-3.3-70b-versatile",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "qwen/qwen3-32b",
        "llama-3.1-8b-instant",
    ]

    def __init__(
        self,
        api_key: str,
        model_name: str = "llama-3.3-70b-versatile",
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> None:
        if not GROQ_AVAILABLE or AsyncGroq is None:
            raise ImportError(
                "Groq SDK is not installed. Install it with: pip install groq"
            )
        if not api_key:
            raise ValueError("Missing GROQ_API_KEY")

        self.model_name = model_name
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.client = AsyncGroq(api_key=api_key)

        # Build fallback chain: primary model first, then others (no duplicates)
        self._fallback_models: list[str] = [model_name]
        for m in self.FALLBACK_MODELS:
            if m != model_name:
                self._fallback_models.append(m)

    @staticmethod
    def _is_rate_limit_error(exc: Exception) -> bool:
        """Check if an exception is a Groq rate-limit (429) error."""
        cls_name = type(exc).__name__
        if "RateLimitError" in cls_name:
            return True
        for attr in ("status_code", "code", "http_status"):
            if hasattr(exc, attr) and getattr(exc, attr) == 429:
                return True
        return False

    async def _call_with_fallback(self, kwargs: dict[str, Any]) -> Any:
        """Call the Groq API, falling back to other models on rate-limit."""
        last_exc: Exception | None = None
        for model in self._fallback_models:
            kwargs["model"] = model
            try:
                response = await self.client.chat.completions.create(**kwargs)
                if model != self.model_name:
                    logger.info(
                        "Groq: fell back to model %s (primary rate-limited)", model
                    )
                return response
            except Exception as exc:
                if self._is_rate_limit_error(exc):
                    logger.warning(
                        "Groq rate-limited on %s, trying next model…", model
                    )
                    last_exc = exc
                    continue
                raise  # non-rate-limit errors propagate immediately
        raise last_exc or RuntimeError("All Groq fallback models rate-limited")

    async def chat_with_tools(
        self,
        message: str,
        tools: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Send a message to Groq with tool-calling support.

        Returns a dict matching the format chat_handler expects:
            {"message": {"content": "...", "tool_calls": [...]}}

        Automatically falls back to alternate Groq models if rate-limited.
        """
        messages = self._build_messages(conversation_history, message)

        kwargs: dict[str, Any] = {
            "model": self.model_name,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

        if tools:
            kwargs["tools"] = [_convert_tool_schema_to_openai(t) for t in tools]
            kwargs["tool_choice"] = "auto"

        response = await self._call_with_fallback(kwargs)
        choice = response.choices[0]

        # Build response in the format chat_handler expects (Ollama-compatible)
        result: dict[str, Any] = {
            "message": {
                "content": choice.message.content or "",
            }
        }

        if choice.message.tool_calls:
            result["message"]["tool_calls"] = _convert_tool_calls_to_ollama_format(
                choice.message.tool_calls
            )

        return result

    async def continue_conversation(
        self,
        tool_results: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> str:
        """Continue conversation after tool execution.

        Tool results are expected to already be in ``conversation_history``
        (added by the caller).  We sanitise the messages and send them.
        """
        # Sanitise tool_calls in history for Groq compatibility
        messages = []
        for msg in conversation_history:
            if msg.get("tool_calls"):
                msg = dict(msg)
                sanitised = []
                for tc in msg["tool_calls"]:
                    tc = dict(tc)
                    tc.setdefault("type", "function")
                    tc.setdefault("id", f"call_{id(tc)}")
                    sanitised.append(tc)
                msg["tool_calls"] = sanitised
            messages.append(msg)

        kwargs: dict[str, Any] = {
            "model": self.model_name,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

        if tools:
            kwargs["tools"] = [_convert_tool_schema_to_openai(t) for t in tools]

        response = await self._call_with_fallback(kwargs)
        return response.choices[0].message.content or ""

    async def chat(
        self,
        message: str,
        conversation_history: list[dict[str, Any]] | None = None,
        system_prompt: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str | None:
        """Simple chat without tools (used by orchestration router classifier).

        Automatically falls back to alternate Groq models if rate-limited.
        """
        messages: list[dict[str, Any]] = []

        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        if conversation_history:
            messages.extend(conversation_history)

        messages.append({"role": "user", "content": message})

        kwargs: dict[str, Any] = {
            "model": self.model_name,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.temperature,
            "max_tokens": max_tokens or self.max_tokens,
        }

        response = await self._call_with_fallback(kwargs)
        return response.choices[0].message.content

    @staticmethod
    def _build_messages(
        conversation_history: list[dict[str, Any]] | None,
        user_message: str,
    ) -> list[dict[str, Any]]:
        """Build the messages list for the API call.

        Sanitises history entries so that assistant messages with ``tool_calls``
        always include the ``type`` field required by Groq/OpenAI.
        """
        messages: list[dict[str, Any]] = []
        for msg in conversation_history or []:
            if msg.get("tool_calls"):
                msg = dict(msg)  # shallow copy to avoid mutating memory
                sanitised = []
                for tc in msg["tool_calls"]:
                    tc = dict(tc)
                    tc.setdefault("type", "function")
                    tc.setdefault("id", f"call_{id(tc)}")
                    sanitised.append(tc)
                msg["tool_calls"] = sanitised
            messages.append(msg)
        messages.append({"role": "user", "content": user_message})
        return messages
