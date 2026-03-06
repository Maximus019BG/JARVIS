from __future__ import annotations
from typing import Any, Literal

from core.base_tool import BaseTool, ToolResult
from core.sync.async_bridge import run_coro_sync
from core.sync.sync_factory import build_sync_stack


class ResolveConflictTool(BaseTool):
    """Chat tool for resolving blueprint conflicts."""

    @property
    def name(self) -> str:
        return "resolve_conflict"

    @property
    def description(self) -> str:
        return "Resolve a sync conflict for a blueprint. Requires blueprint_id and resolution (server/local/merge)"

    def __init__(self):
        stack = build_sync_stack()
        self.security = stack.security
        self.http_client = stack.http_client
        self.device_token = stack.device_token
        self.device_id = stack.device_id
        self.sync_manager = stack.sync_manager

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "blueprint_id": {
                    "type": "string",
                    "description": "Blueprint id with a sync conflict",
                },
                "resolution": {
                    "type": "string",
                    "description": "Conflict resolution strategy",
                    "enum": ["server", "local", "merge"],
                },
            },
            "required": ["blueprint_id", "resolution"],
        }

    def execute(
        self,
        blueprint_id: str = "",
        resolution: Literal["server", "local", "merge"] | str = "",
        **_: Any,
    ) -> ToolResult:
        if not blueprint_id:
            return ToolResult.fail(
                "blueprint_id is required", error_type="ValidationError"
            )

        if resolution not in ("server", "local", "merge"):
            return ToolResult.fail(
                "resolution must be 'server', 'local', or 'merge'",
                error_type="ValidationError",
            )

        try:
            result = run_coro_sync(
                self.sync_manager.resolve_conflict(blueprint_id, str(resolution)),
                timeout=90,
            )
            content = (
                f"Resolved conflict for blueprint: {result.get('blueprintId')}\n"
                f"version: {result.get('version')}"
            )
            return ToolResult.ok_result(
                content,
                blueprintId=result.get("blueprintId"),
                version=result.get("version"),
            )
        except Exception as e:
            return ToolResult.fail(f"Resolution failed: {e}", error_type="Exception")
