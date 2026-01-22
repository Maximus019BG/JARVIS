"""Tool to activate smart mode."""

from __future__ import annotations

# Local application imports
from core.base_tool import BaseTool


class SmartModeTool(BaseTool):
    """Tool for activating smart mode."""

    @property
    def name(self) -> str:
        return "smart_mode"

    @property
    def description(self) -> str:
        return "Activates smart mode for AI-powered chat and assistance."

    def execute(self, **kwargs) -> str:
        """Execute the smart mode tool.

        Args:
            **kwargs: Unused parameters (kept for interface compatibility).

        Returns:
            A message confirming smart mode activation.
        """
        return "Smart mode activated. You can now chat with the AI assistant."

    def get_schema(self) -> dict:
        return super().get_schema()
