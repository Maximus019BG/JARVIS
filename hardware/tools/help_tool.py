"""Help tool to list available tools and their usage."""

from typing import Dict

from core.base_tool import BaseTool
from core.tool_registry import ToolRegistry


class HelpTool(BaseTool):
    """Tool to provide help information about available tools."""

    def __init__(self, tool_registry: ToolRegistry):
        self.tool_registry = tool_registry

    @property
    def name(self) -> str:
        return "help"

    @property
    def description(self) -> str:
        return "Provides information about available tools and their usage."

    def execute(self, **kwargs) -> str:
        tools = self.tool_registry.get_all_tools()
        help_text = "Available tools:\n"
        for tool in tools:
            help_text += f"- {tool.name}: {tool.description}\n"
        return help_text

    def get_schema(self) -> Dict:
        schema = super().get_schema()
        # No parameters needed for help
        return schema
