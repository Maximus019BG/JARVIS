"""Base class for all tools in the chat-driven hardware app."""

from abc import ABC, abstractmethod
from typing import Any, Dict


class BaseTool(ABC):
    """Abstract base class for tools."""

    @property
    @abstractmethod
    def name(self) -> str:
        """The name of the tool."""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Description of what the tool does."""
        pass

    @abstractmethod
    def execute(self, **kwargs) -> str:
        """Execute the tool with given parameters.

        Args:
            **kwargs: Tool-specific parameters.

        Returns:
            str: Result message to display to user.
        """
        pass

    def get_schema(self) -> Dict[str, Any]:
        """Get the tool schema for AI tool calling.

        Returns:
            Dict: Schema describing the tool for AI consumption.
        """
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {},  # Override in subclasses
                    "required": []  # Override in subclasses
                }
            }
        }
