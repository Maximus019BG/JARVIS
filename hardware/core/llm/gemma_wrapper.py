"""Wrapper for Gemma 3 1B model using Ollama."""

from __future__ import annotations

# Standard library imports
import asyncio
import logging
from typing import Any

try:
    import ollama

    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False
    ollama = None

logger = logging.getLogger(__name__)


class GemmaWrapper:
    """Wrapper for interacting with Gemma 3 1B via Ollama."""

    def __init__(self, model_name: str = "gemma3:1b"):
        self.model_name = model_name
        if not OLLAMA_AVAILABLE:
            raise ImportError(
                "Ollama is not installed. Install it with: pip install ollama"
            )
        self.client = ollama.AsyncClient()
        self._supports_tools: bool | None = None  # auto-detected on first call

    async def chat_with_tools(
        self,
        message: str,
        tools: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Send a message to the LLM with tool capabilities and get response.

        Args:
            message: User message
            tools: List of tool schemas
            conversation_history: Previous messages for context

        Returns:
            Dict containing response and tool calls if any
        """
        messages = conversation_history or []

        # Add current user message
        messages.append({"role": "user", "content": message})

        # Try with tools first; fall back to plain chat if not supported
        if self._supports_tools is not False and tools:
            try:
                response = await self.client.chat(
                    model=self.model_name, messages=messages, tools=tools, stream=False
                )
                self._supports_tools = True
                return response
            except Exception as exc:
                if "does not support tools" in str(exc):
                    logger.warning(
                        "%s does not support tool calling, falling back to plain chat",
                        self.model_name,
                    )
                    self._supports_tools = False
                else:
                    raise

        # Plain chat (no tools)
        response = await self.client.chat(
            model=self.model_name, messages=messages, stream=False
        )
        return response

    async def continue_conversation(
        self,
        tool_results: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> str:
        """Continue conversation after tool execution.

        Args:
            tool_results: List of tool call results.
                Each entry must include `tool_call_id` and `content`.
            conversation_history: Full conversation history
            tools: Available tools

        Returns:
            Final response from LLM
        """
        # Add tool results as tool messages
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
            "stream": False,
        }
        if self._supports_tools and tools:
            kwargs["tools"] = tools

        response = await self.client.chat(**kwargs)
        return response["message"]["content"]
