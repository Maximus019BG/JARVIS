"""Base class and helpers for all tools.

Tools are invoked by name via [`hardware.core.tool_registry.ToolRegistry`](hardware/core/tool_registry.py)
from [`hardware.core.chat_handler.ChatHandler`](hardware/core/chat_handler.py).

The schema format intentionally matches the "tools" / function-calling shape used
by Ollama / OpenAI-compatible chat APIs.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


class ToolError(Exception):
    """Raised when a tool fails in a predictable/controlled manner."""


@dataclass(frozen=True, slots=True)
class ToolSchema:
    """Minimal representation of a tool's function-calling schema."""

    name: str
    description: str
    parameters: dict[str, Any]

    def to_ollama_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class BaseTool(ABC):
    """Abstract base class for tools."""

    @property
    @abstractmethod
    def name(self) -> str:
        """The name of the tool."""

    @property
    @abstractmethod
    def description(self) -> str:
        """Short description of what the tool does."""

    @abstractmethod
    def execute(self, **kwargs: Any) -> str:
        """Execute the tool with given parameters."""

    # ---- schema helpers ----

    def schema_parameters(self) -> dict[str, Any]:
        """JSON-schema-ish parameters.

        Subclasses should override this to define inputs.
        """

        return {"type": "object", "properties": {}, "required": []}

    def get_schema(self) -> dict[str, Any]:
        """Return the tool schema for AI tool calling."""

        return ToolSchema(
            name=self.name,
            description=self.description,
            parameters=self.schema_parameters(),
        ).to_ollama_schema()
