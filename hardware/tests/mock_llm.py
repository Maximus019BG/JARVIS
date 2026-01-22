"""Mock LLM for testing purposes."""

import asyncio
from typing import Any


class MockLlamaWrapper:
    """Mock implementation of LlamaWrapper for testing."""

    def __init__(self, responses: list[str] | None = None):
        self.responses = responses or ["Mock response"]
        self.response_index = 0
        self.call_count = 0

    async def chat_with_tools(
        self,
        message: str,
        tools: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Return mock response."""
        self.call_count += 1
        response = self.responses[self.response_index % len(self.responses)]
        self.response_index += 1

        # Simulate async delay
        await asyncio.sleep(0.01)

        # Check if message contains "help" to simulate tool call
        if "help" in message.lower():
            return {
                "message": {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "function": {"name": "help", "arguments": "{}"},
                        }
                    ],
                }
            }
        else:
            return {"message": {"content": response}}

    async def continue_conversation(
        self,
        tool_results: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> str:
        """Mock continue conversation."""
        return f"Tool result processed: {tool_results[0]['content'] if tool_results else 'No results'}"

        self,
        tool_results: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> str:
        """Mock continue conversation."""
        await asyncio.sleep(0.01)
        return f"Tool result processed: {tool_results[0]['content'] if tool_results else 'No results'}"
