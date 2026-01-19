"""Tool to activate live assistance mode."""

from typing import Dict

from core.base_tool import BaseTool


class LiveAssistanceTool(BaseTool):
    """Tool for live assistance."""

    @property
    def name(self) -> str:
        return "live_assistance"

    @property
    def description(self) -> str:
        return "Activates live assistance mode."

    def execute(self, **kwargs) -> str:
        return "Live assistance mode activated. Real-time help and guidance is now available."

    def get_schema(self) -> Dict:
        return super().get_schema()
