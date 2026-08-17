"""Moonshot API wrapper for JARVIS.

Uses the OpenAI Python SDK with custom base_url for Kimi model inference.
Moonshot API is OpenAI-compatible with tool-calling support.

Docs: https://platform.moonshot.cn/docs
"""

from __future__ import annotations

import json
import logging
from typing import Any

try:
    from openai import AsyncOpenAI

    MOONSHOT_AVAILABLE = True
except ImportError:
    AsyncOpenAI = None  # type: ignore
    MOONSHOT_AVAILABLE = False

logger = logging.getLogger(__name__)


def _convert_tool_schema_to_openai(tool: dict[str, Any]) -> dict[str, Any]:
    """Convert tool schema to OpenAI format (passthrough)."""
    return tool


def _convert_tool_calls_to_ollama_format(tool_calls: list[Any]) -> list[dict[str, Any]]:
    """Convert OpenAI tool call objects to dict format chat_handler expects."""
    result = []
    for tc in tool_calls:
        entry: dict[str, Any] = {
            "id": tc.id,
            "type": "function",
            "function": {
                "name": tc.function.name,
                "arguments": tc.function.arguments,
            },
        }
        result.append(entry)
    return result


class MoonshotWrapper:
    """Wrapper for Moonshot API (Kimi models).

    Uses OpenAI SDK with custom base_url since Moonshot is OpenAI-compatible.
    """

    AVAILABLE_MODELS: list[str] = [
        "kimi-k2.5",              # Latest multimodal model (recommended)
        "kimi-k2-turbo-preview",  # Fast turbo model
        "kimi-k2-thinking",       # Reasoning/thinking model
        "moonshot-v1-auto",       # Auto-select context length
        "moonshot-v1-8k",         # Legacy 8K context
        "moonshot-v1-32k",        # Legacy 32K context
        "moonshot-v1-128k",       # Legacy 128K context
    ]

    def __init__(
        self,
        api_key: str,
        model_name: str = "kimi-k2.5",
        base_url: str = "https://api.moonshot.ai/v1",
        temperature: float = 0.6,
        max_tokens: int = 4096,
    ) -> None:
        if not MOONSHOT_AVAILABLE or AsyncOpenAI is None:
            raise ImportError(
                "OpenAI SDK is not installed. Install it with: pip install openai"
            )
        if not api_key:
            raise ValueError("Missing MOONSHOT_API_KEY")

        self.model_name = model_name
        self.base_url = base_url
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def chat_with_tools(
        self,
        message: str,
        tools: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Send a message with tool-calling support."""
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

        result: dict[str, Any] = {"message": {"content": choice.message.content or ""}}

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
        """Continue conversation after tool execution."""
        messages = []
        for msg in conversation_history:
            if msg.get("tool_calls"):
                msg = dict(msg)
                sanitised = []
                for tc in msg["tool_calls"]:
                    tc = dict(tc)
                    tc.setdefault("type", "function")
                    tc.setdefault("id", f"call_{id(tc)}")
                    fn = tc.get("function")
                    if isinstance(fn, dict):
                        fn = dict(fn)
                        args = fn.get("arguments")
                        if isinstance(args, dict):
                            fn["arguments"] = json.dumps(args)
                        elif args is None:
                            fn["arguments"] = "{}"
                        tc["function"] = fn
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
        """Simple chat without tools."""
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
        """Build messages list with sanitized tool_calls."""
        messages: list[dict[str, Any]] = []
        for msg in conversation_history or []:
            if msg.get("tool_calls"):
                msg = dict(msg)
                sanitised = []
                for tc in msg["tool_calls"]:
                    tc = dict(tc)
                    tc.setdefault("type", "function")
                    tc.setdefault("id", f"call_{id(tc)}")
                    fn = tc.get("function")
                    if isinstance(fn, dict):
                        fn = dict(fn)
                        args = fn.get("arguments")
                        if isinstance(args, dict):
                            fn["arguments"] = json.dumps(args)
                        elif args is None:
                            fn["arguments"] = "{}"
                        tc["function"] = fn
                    sanitised.append(tc)
                msg["tool_calls"] = sanitised
            messages.append(msg)
        messages.append({"role": "user", "content": user_message})
        return messages
