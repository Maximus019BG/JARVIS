"""Wrapper for Llama 3.2 3B model using Ollama."""

from __future__ import annotations

# Standard library imports
import asyncio
from typing import Any

try:
    import ollama

    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False
    ollama = None


class LlamaWrapper:
    """Wrapper for interacting with Llama 3.2 3B via Ollama."""

    def __init__(self, model_name: str = "llama3.2:3b"):
        self.model_name = model_name
        if not OLLAMA_AVAILABLE:
            raise ImportError(
                "Ollama is not installed. Install it with: pip install ollama"
            )
        self.client = ollama.Client()

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

        # Make the call to Ollama with tools
        response = await self.client.chat(
            model=self.model_name, messages=messages, tools=tools, stream=False
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
            tool_results: List of tool call results with call_id
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
                    "tool_call_id": result["call_id"],
                }
            )

        response = await self.client.chat(
            model=self.model_name,
            messages=conversation_history,
            tools=tools,
            stream=False,
        )

        return response["message"]["content"]
