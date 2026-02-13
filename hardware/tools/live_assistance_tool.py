"""Tool to activate live assistance mode."""

from __future__ import annotations

from typing import Any

# Local application imports
from core.base_tool import BaseTool, ToolResult


class LiveAssistanceTool(BaseTool):
    """Tool for live assistance."""

    @property
    def name(self) -> str:
        return "live_assistance"

    @property
    def description(self) -> str:
        return "Activates live assistance mode."

    def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the live assistance tool.

        Args:
            **kwargs: Unused parameters (kept for interface compatibility).

        Returns:
            A structured [`ToolResult`](hardware/core/base_tool.py:1).
        """
        return ToolResult.ok_result(
            "Live assistance mode activated. Real-time help and guidance is now available."
        )
