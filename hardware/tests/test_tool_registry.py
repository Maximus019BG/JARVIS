"""Tests for ToolRegistry."""

import logging
from unittest.mock import Mock

import pytest

from core.tool_registry import ToolRegistry


class TestToolRegistry:
    """Test cases for ToolRegistry."""

    def test_version_starts_at_zero(self, registry):
        assert registry.get_version() == 0

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

    def test_version_increments_on_register(self, registry, mock_tool):
        registry.register_tool(mock_tool)
        assert registry.get_version() == 1

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

    def test_version_increments_on_unregister(self, registry, mock_tool):
        registry.register_tool(mock_tool)
        registry.unregister_tool(mock_tool.name)
        assert registry.get_version() == 2

    def test_version_increments_on_clear(self, registry, mock_tool):
        registry.register_tool(mock_tool)
        registry.clear()
        assert registry.get_version() == 2

    def test_get_tool_schemas(self, registry, mock_tool):
        """Test getting tool schemas."""
        registry.register_tool(mock_tool)
        schemas = registry.get_tool_schemas()
        assert len(schemas) == 1
        assert schemas[0]["function"]["name"] == "mock_tool"

    def test_duplicate_registration_warns_and_overwrites(self, registry, caplog):
        first = Mock()
        first.name = "dupe_tool"

        second = Mock()
        second.name = "dupe_tool"

        with caplog.at_level(logging.WARNING):
            registry.register_tool(first)
            registry.register_tool(second)

        assert registry.get_tool("dupe_tool") is second
        assert registry.get_version() == 2

        assert any(
            "Duplicate tool registration" in record.message and "dupe_tool" in record.message
            for record in caplog.records
        )
