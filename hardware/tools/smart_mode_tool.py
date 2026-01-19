"""Tool to activate smart mode."""

from typing import Dict

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
        return "Smart mode activated. You can now chat with the AI assistant."

    def get_schema(self) -> Dict:
        return super().get_schema()
