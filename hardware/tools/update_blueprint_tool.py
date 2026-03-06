from __future__ import annotations
from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.sync.async_bridge import run_coro_sync
from core.sync.sync_factory import build_sync_stack


class UpdateBlueprintTool(BaseTool):
    """Chat tool for updating blueprints from server."""

    @property
    def name(self) -> str:
        return "update_blueprint"

    @property
    def description(self) -> str:
        return (
            "Update a local blueprint from the server. Requires blueprint_id parameter."
        )

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
                    "description": "Blueprint id to update from server",
                }
            },
            "required": ["blueprint_id"],
        }

    def execute(self, blueprint_id: str = "", **_: Any) -> ToolResult:
        if not blueprint_id:
            return ToolResult.fail(
                "blueprint_id is required", error_type="ValidationError"
            )

        try:
            result = run_coro_sync(
                self.sync_manager.update_blueprint(blueprint_id),
                timeout=90,
            )
            blueprint = (result or {}).get("blueprint") or {}
            content = (
                f"Updated blueprint: {blueprint.get('name')}\n"
                f"blueprintId: {blueprint.get('id')}\n"
                f"version: {blueprint.get('version')}\n"
                f"lastModified: {blueprint.get('lastModified')}"
            )
            return ToolResult.ok_result(
                content,
                blueprintId=blueprint.get("id"),
                name=blueprint.get("name"),
                version=blueprint.get("version"),
                lastModified=blueprint.get("lastModified"),
            )
        except Exception as e:
            return ToolResult.fail(f"Update failed: {e}", error_type="Exception")
