"""Tool to quit the application."""

from __future__ import annotations

# Local application imports
from core.base_tool import BaseTool, ToolResult


class QuitTool(BaseTool):
    """Tool for quitting the application."""

    @property
    def name(self) -> str:
        return "quit"

    @property
    def description(self) -> str:
        return "Exits the application."

    def execute(self, **kwargs) -> ToolResult:
        """Execute the quit tool."""

        return ToolResult.ok_result("Exiting application (stub).")

    def get_schema(self) -> dict:
        return super().get_schema()
