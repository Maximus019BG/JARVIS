"""Tool registry for managing available tools."""

from typing import Dict, List

from .base_tool import BaseTool


class ToolRegistry:
    """Registry for tools available to the AI agent."""

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}

    def register_tool(self, tool: BaseTool) -> None:
        """Register a tool."""
        self._tools[tool.name] = tool

    def get_tool(self, name: str) -> BaseTool:
        """Get a tool by name."""
        return self._tools[name]

    def get_all_tools(self) -> List[BaseTool]:
        """Get all registered tools."""
        return list(self._tools.values())

    def get_tool_schemas(self) -> List[Dict]:
        """Get schemas for all tools for AI consumption."""
        return [tool.get_schema() for tool in self._tools.values()]
