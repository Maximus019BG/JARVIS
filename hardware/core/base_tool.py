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
class ToolResult:
    """Structured result returned by tools.

    This is intentionally JSON-serializable and stable for provider/tool plumbing.

    Fields:
        ok: Whether the tool succeeded.
        content: Human-readable payload; always present.
        tool: Tool name at point of execution (optional).
        call_id: LLM tool-call id (optional).
        error_type: Short machine-readable error classification.
        error_details: JSON-serializable details for logging/tests.
        duration_ms: Execution duration in milliseconds.
    """

    ok: bool
    content: str
    tool: str | None = None
    call_id: str | None = None
    error_type: str | None = None
    error_details: dict[str, Any] | None = None
    duration_ms: int | None = None

    @staticmethod
    def ok_result(
        content: str,
        *,
        tool: str | None = None,
        call_id: str | None = None,
        duration_ms: int | None = None,
        **meta: Any,
    ) -> "ToolResult":
        # meta is merged into error_details for optional structured metadata.
        error_details = meta if meta else None
        return ToolResult(
            ok=True,
            content=content,
            tool=tool,
            call_id=call_id,
            duration_ms=duration_ms,
            error_details=error_details,
        )

    @staticmethod
    def fail(
        content: str,
        *,
        tool: str | None = None,
        call_id: str | None = None,
        error_type: str | None = None,
        error_details: dict[str, Any] | None = None,
        duration_ms: int | None = None,
    ) -> "ToolResult":
        return ToolResult(
            ok=False,
            content=content,
            tool=tool,
            call_id=call_id,
            error_type=error_type,
            error_details=error_details,
            duration_ms=duration_ms,
        )

    def to_message_content(self) -> str:
        """String content sent back to the LLM as tool message content."""

        return self.content

    def to_dict(self) -> dict[str, Any]:
        """Full JSON-serializable dict for logs/tests."""

        return {
            "ok": self.ok,
            "content": self.content,
            "tool": self.tool,
            "call_id": self.call_id,
            "error_type": self.error_type,
            "error_details": self.error_details,
            "duration_ms": self.duration_ms,
        }


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
    def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the tool with given parameters.

        Args:
            **kwargs: Tool-specific parameters as defined in the tool's schema.

        Returns:
            A structured [`ToolResult`](hardware/core/base_tool.py:1).
        """

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
