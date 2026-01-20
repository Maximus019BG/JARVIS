"""Tests for ToolRegistry."""

from unittest.mock import Mock

import pytest

from core.tool_registry import ToolRegistry


class TestToolRegistry:
    """Test cases for ToolRegistry."""

    @pytest.fixture
    def registry(self):
        """Empty tool registry."""
        return ToolRegistry()

    @pytest.fixture
    def mock_tool(self):
        """Mock tool."""
        tool = Mock()
        tool.name = "mock_tool"
        tool.description = "Mock tool for testing"
        tool.get_schema.return_value = {
            "type": "function",
            "function": {
                "name": "mock_tool",
                "description": "Mock tool for testing",
                "parameters": {
                    "type": "object",
                    "properties": {"param1": {"type": "string"}},
                    "required": ["param1"],
                },
            },
        }
        return tool

    def test_register_and_get_tool(self, registry, mock_tool):
        """Test registering and retrieving a tool."""
        registry.register_tool(mock_tool)
        retrieved = registry.get_tool("mock_tool")
        assert retrieved == mock_tool

    def test_get_nonexistent_tool(self, registry):
        """Test getting a tool that doesn't exist."""
        with pytest.raises(KeyError):
            registry.get_tool("nonexistent")

    def test_get_all_tools(self, registry, mock_tool):
        """Test getting all registered tools."""
        registry.register_tool(mock_tool)
        tools = registry.get_all_tools()
        assert len(tools) == 1
        assert tools[0] == mock_tool

    def test_get_tool_schemas(self, registry, mock_tool):
        """Test getting tool schemas."""
        registry.register_tool(mock_tool)
        schemas = registry.get_tool_schemas()
        assert len(schemas) == 1
        assert schemas[0]["function"]["name"] == "mock_tool"
