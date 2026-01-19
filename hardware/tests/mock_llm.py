"""Mock LLM for testing purposes."""

import asyncio
from typing import Any, Dict, List, Optional


class MockLlamaWrapper:
    """Mock implementation of LlamaWrapper for testing."""

    def __init__(self, responses: Optional[List[str]] = None):
        self.responses = responses or ["Mock response"]
        self.response_index = 0
        self.call_count = 0

    def chat_with_tools(self, message: str, tools: List[Dict[str, Any]], conversation_history: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Return mock response."""
        self.call_count += 1
        response = self.responses[self.response_index % len(self.responses)]
        self.response_index += 1

        # Check if message contains "help" to simulate tool call
        if "help" in message.lower():
            return {
                "message": {
                    "content": "",
                    "tool_calls": [{
                        "id": "call_1",
                        "function": {
                            "name": "help",
                            "arguments": "{}"
                        }
                    }]
                }
            }
        else:
            return {
                "message": {
                    "content": response
                }
            }

    async def chat_with_tools_async(self, message: str, tools: List[Dict[str, Any]], conversation_history: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Async version of mock chat."""
        # Simulate async delay
        await asyncio.sleep(0.01)
        return self.chat_with_tools(message, tools, conversation_history)

    def continue_conversation(self, tool_results: List[Dict[str, Any]], conversation_history: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> str:
        """Mock continue conversation."""
        return f"Tool result processed: {tool_results[0]['content'] if tool_results else 'No results'}"

    async def continue_conversation_async(self, tool_results: List[Dict[str, Any]], conversation_history: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> str:
        """Async version of mock continue."""
        await asyncio.sleep(0.01)
        return self.continue_conversation(tool_results, conversation_history, tools)
