"""Tool to activate smart mode."""

from __future__ import annotations

# Local application imports
from core.base_tool import BaseTool, ToolResult


class SmartModeTool(BaseTool):
    """Tool for activating smart mode."""

    @property
    def name(self) -> str:
        return "smart_mode"

    @property
    def description(self) -> str:
        return "Activates smart mode for AI-powered chat and assistance."

    def execute(self, **kwargs) -> ToolResult:
        """Execute the smart mode tool."""

        return ToolResult.ok_result(
            "Smart mode activated. You can now chat with the AI assistant."
        )
