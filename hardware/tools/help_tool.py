"""Help tool to list available tools and their usage."""

from __future__ import annotations

from typing import Any

from hardware.core.base_tool import BaseTool
from hardware.core.tool_registry import ToolRegistry


class HelpTool(BaseTool):
    """Tool to provide help information about available tools."""

    def __init__(self, tool_registry: ToolRegistry) -> None:
        self.tool_registry = tool_registry

    @property
    def name(self) -> str:
        return "help"

    @property
    def description(self) -> str:
        return "Provides information about available tools and their usage."

    def execute(self, **kwargs: Any) -> str:
        tools = self.tool_registry.get_all_tools()
        lines = ["Available tools:"]
        for tool in tools:
            lines.append(f"- {tool.name}: {tool.description}")
        return "\n".join(lines) + "\n"
