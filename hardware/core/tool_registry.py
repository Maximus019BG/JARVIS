"""Tool registry for managing available tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app_logging.logger import get_logger
from core.base_tool import BaseTool

logger = get_logger(__name__)


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
        # Monotonic registry version for cache invalidation.
        self._version: int = 0

    def get_version(self) -> int:
        """Return the current monotonic version of the registry.

        The version increments whenever the registry's externally observable tool set
        may have changed (e.g., tool registered/unregistered).
        """

        return self._version

    def register_tool(self, tool: BaseTool) -> None:
        """Register a tool.

        Tool names must be unique.
        """

        if tool.name in self._tools:
            old_tool = self._tools[tool.name]
            old_qualname = f"{old_tool.__class__.__module__}.{old_tool.__class__.__qualname__}"
            new_qualname = f"{tool.__class__.__module__}.{tool.__class__.__qualname__}"
            logger.warning(
                "Duplicate tool registration for '%s': overwriting %s with %s",
                tool.name,
                old_qualname,
                new_qualname,
            )

        # Treat overwrite registration as a change (schema may differ).
        self._tools[tool.name] = tool
        self._version += 1

    def unregister_tool(self, name: str) -> None:
        """Unregister a tool by name.

        Args:
            name: The name of the tool to unregister.

        Raises:
            ToolNotFoundError: If the tool is not registered.
        """
        if name not in self._tools:
            raise ToolNotFoundError(name)
        del self._tools[name]
        self._version += 1

    def clear(self) -> None:
        """Clear all registered tools."""

        if not self._tools:
            return
        self._tools.clear()
        self._version += 1

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

        # Deterministic ordering for stable downstream behavior/tests.
        return [self._tools[name].get_schema() for name in sorted(self._tools)]
