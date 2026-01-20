#!/usr/bin/env python3
"""End-to-end test for the chat system using mock LLM."""

from __future__ import annotations

from hardware.core.chat_handler import ChatHandler
from hardware.core.tool_registry import ToolRegistry
from hardware.tests.mock_llm import MockLlamaWrapper
from hardware.tools.create_blueprint_tool import CreateBlueprintTool
from hardware.tools.help_tool import HelpTool


def test_end_to_end() -> None:
    """Test the complete chat system."""

    # Setup
    registry = ToolRegistry()
    registry.register_tool(HelpTool(registry))
    registry.register_tool(CreateBlueprintTool())

    mock_llm = MockLlamaWrapper()
    chat_handler = ChatHandler(registry, llm=mock_llm)

    # Test basic conversation
    response = chat_handler.process_message("Hello")
    assert "Mock response" in response

    # Test tool calling
    response = chat_handler.process_message("Please help")
    assert "Tool result processed" in response

    # Test conversation memory
    history = chat_handler.memory.get_history()
    assert len(history) >= 4  # user, assistant, user, assistant


if __name__ == "__main__":
    test_end_to_end()
