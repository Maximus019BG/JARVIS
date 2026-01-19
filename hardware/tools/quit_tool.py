"""Tool to quit the application."""

from typing import Dict

from core.base_tool import BaseTool


class QuitTool(BaseTool):
    """Tool for quitting the application."""

    @property
    def name(self) -> str:
        return "quit"

    @property
    def description(self) -> str:
        return "Exits the application."

    def execute(self, **kwargs) -> str:
        return "Exiting application (stub)."

    def get_schema(self) -> Dict:
        return super().get_schema()
