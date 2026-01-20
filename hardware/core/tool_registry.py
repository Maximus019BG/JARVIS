"""Tool registry for managing available tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from hardware.core.base_tool import BaseTool


class ToolNotFoundError(KeyError):
    """Raised when a requested tool is not registered."""


@dataclass(frozen=True, slots=True)
class ToolLookup:
    """A small helper returned by [`ToolRegistry.lookup`](hardware/core/tool_registry.py)."""

    name: str
    tool: BaseTool


class ToolRegistry:
    """Registry for tools available to the AI agent."""

    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}

    def register_tool(self, tool: BaseTool) -> None:
        """Register a tool.

        Tool names must be unique.
        """

        self._tools[tool.name] = tool

    def get_tool(self, name: str) -> BaseTool:
        """Get a tool by name."""

        try:
            return self._tools[name]
        except KeyError as exc:
            raise ToolNotFoundError(name) from exc

    def lookup(self, name: str) -> ToolLookup:
        return ToolLookup(name=name, tool=self.get_tool(name))

    def get_all_tools(self) -> list[BaseTool]:
        """Get all registered tools."""

        return list(self._tools.values())

    def get_tool_schemas(self) -> list[dict[str, Any]]:
        """Get schemas for all tools for AI consumption."""

        return [tool.get_schema() for tool in self._tools.values()]
