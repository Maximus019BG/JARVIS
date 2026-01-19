#!/usr/bin/env python3
"""End-to-end test for the chat system using mock LLM."""

from core.chat_handler import ChatHandler
from core.tool_registry import ToolRegistry
from tests.mock_llm import MockLlamaWrapper
from tools.create_blueprint_tool import CreateBlueprintTool
from tools.help_tool import HelpTool


def test_end_to_end():
    """Test the complete chat system."""
    print("Testing JARVIS Hardware Chat System End-to-End")

    # Setup
    registry = ToolRegistry()
    registry.register_tool(HelpTool(registry))
    registry.register_tool(CreateBlueprintTool())

    mock_llm = MockLlamaWrapper()
    chat_handler = ChatHandler(registry, llm=mock_llm)

    # Test basic conversation
    print("\n1. Testing basic conversation...")
    response = chat_handler.process_message("Hello")
    print(f"Response: {response}")
    assert "Mock response" in response

    # Test tool calling
    print("\n2. Testing tool calling...")
    response = chat_handler.process_message("Please help")
    print(f"Response: {response}")
    assert "Tool result processed" in response

    # Test conversation memory
    print("\n3. Testing conversation memory...")
    history = chat_handler.memory.get_history()
    print(f"Conversation length: {len(history)}")
    assert len(history) >= 4  # user, assistant, user, assistant

    print("\n✅ All end-to-end tests passed!")


if __name__ == "__main__":
    test_end_to_end()
