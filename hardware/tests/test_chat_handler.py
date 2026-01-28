"""Tests for ChatHandler."""

import asyncio
from unittest.mock import Mock

import pytest

from core.base_tool import ToolResult
from core.chat_handler import ChatHandler
from core.tool_registry import ToolRegistry
from tests.mock_llm import MockLlamaWrapper


class TestChatHandler:
    """Test cases for ChatHandler."""

    def test_tool_schema_cache_reused_when_registry_version_unchanged(self, chat_handler):
        first = chat_handler._get_cached_tool_schemas()
        second = chat_handler._get_cached_tool_schemas()
        assert first is second

    def test_tool_schema_cache_invalidates_when_registry_version_changes(
        self, tool_registry, mock_llm
    ):
        handler = ChatHandler(tool_registry, llm=mock_llm)

        first = handler._get_cached_tool_schemas()

        # Mutate registry -> version bump
        new_tool = Mock()
        new_tool.name = "another_tool"
        new_tool.description = "Another tool"
        new_tool.execute.return_value = ToolResult.ok_result("ok")
        new_tool.get_schema.return_value = {
            "type": "function",
            "function": {
                "name": "another_tool",
                "description": "Another tool",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        }
        tool_registry.register_tool(new_tool)

        second = handler._get_cached_tool_schemas()

        assert second is not first
        assert any(schema["function"]["name"] == "another_tool" for schema in second)

    @pytest.fixture
    def mock_llm(self):
        """Mock LLM wrapper."""
        return MockLlamaWrapper()

    @pytest.fixture
    def tool_registry(self):
        """Tool registry with mock tools."""
        registry = ToolRegistry()

        # Add a mock tool
        mock_tool = Mock()
        mock_tool.name = "test_tool"
        mock_tool.description = "Test tool"
        mock_tool.execute.return_value = ToolResult.ok_result("Tool executed")
        mock_tool.get_schema.return_value = {
            "type": "function",
            "function": {
                "name": "test_tool",
                "description": "Test tool",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        }
        registry.register_tool(mock_tool)

        return registry

    @pytest.fixture
    def chat_handler(self, tool_registry, mock_llm):
        """Chat handler instance."""
        handler = ChatHandler(tool_registry, llm=mock_llm)
        return handler

    def test_process_message_no_tools(self, chat_handler):
        """Test processing message without tool calls."""
        response = asyncio.run(chat_handler.process_message("Hello"))
        assert response == "Mock response"
        assert len(chat_handler.memory.get_history()) == 2  # user + assistant

    def test_process_message_with_tools(self, chat_handler):
        """Test processing message with tool calls."""
        response = asyncio.run(chat_handler.process_message("Please help"))
        assert "Tool result processed" in response

    def test_execute_tool_call_success(self, chat_handler, tool_registry):
        """Test successful tool execution."""
        tool_call = {
            "id": "call_1",
            "function": {"name": "test_tool", "arguments": "{}"},
        }
        result = chat_handler.execute_tool_call(tool_call)
        assert result.ok is True
        assert result.content == "Tool executed"

    def test_execute_tool_call_error(self, chat_handler):
        """Test tool execution with error."""
        tool_call = {
            "id": "call_1",
            "function": {"name": "nonexistent_tool", "arguments": "{}"},
        }
        result = chat_handler.execute_tool_call(tool_call)
        assert result.ok is False
        assert "Error executing tool" in result.content
        assert result.error_type == "ToolNotFound"
