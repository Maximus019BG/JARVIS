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
    """Wrapper for interacting with Groq's API (Llama 3, Mixtral, etc.)."""

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

    async def chat_with_tools(
        self,
        message: str,
        tools: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Send a message to Groq with tool-calling support.

        Returns a dict matching the format chat_handler expects:
            {"message": {"content": "...", "tool_calls": [...]}}
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

        response = await self.client.chat.completions.create(**kwargs)
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

        Appends tool results to the history and asks the model for a final response.
        """
        # Add tool results as tool-role messages (OpenAI/Groq format)
        for result in tool_results:
            conversation_history.append(
                {
                    "role": "tool",
                    "content": result["content"],
                    "tool_call_id": result["tool_call_id"],
                }
            )

        kwargs: dict[str, Any] = {
            "model": self.model_name,
            "messages": conversation_history,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

        if tools:
            kwargs["tools"] = [_convert_tool_schema_to_openai(t) for t in tools]

        response = await self.client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""

    async def chat(
        self,
        message: str,
        conversation_history: list[dict[str, Any]] | None = None,
        system_prompt: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str | None:
        """Simple chat without tools (used by orchestration router classifier)."""
        messages: list[dict[str, Any]] = []

        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        if conversation_history:
            messages.extend(conversation_history)

        messages.append({"role": "user", "content": message})

        response = await self.client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            temperature=temperature if temperature is not None else self.temperature,
            max_tokens=max_tokens or self.max_tokens,
        )
        return response.choices[0].message.content

    @staticmethod
    def _build_messages(
        conversation_history: list[dict[str, Any]] | None,
        user_message: str,
    ) -> list[dict[str, Any]]:
        """Build the messages list for the API call."""
        messages = list(conversation_history or [])
        messages.append({"role": "user", "content": user_message})
        return messages
