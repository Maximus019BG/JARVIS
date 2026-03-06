from __future__ import annotations

from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.sync.async_bridge import run_coro_sync
from core.sync.sync_factory import build_sync_stack


class SendBlueprintTool(BaseTool):
    """Chat tool for sending blueprints to server."""

    @property
    def name(self) -> str:
        return "send_blueprint"

    @property
    def description(self) -> str:
        return "Send a local blueprint to the server. Provide either blueprint_path or blueprint_id."

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
                "blueprint_path": {
                    "type": "string",
                    "description": "Path to the local blueprint JSON file",
                },
                "blueprint_id": {
                    "type": "string",
                    "description": "Blueprint id to locate locally (alternative to blueprint_path)",
                },
            },
            "required": [],
        }

    def execute(
        self, blueprint_path: str = "", blueprint_id: str = "", **_: Any
    ) -> ToolResult:
        """Send blueprint to server.

        Note: Under the hood the sync manager is async; we run it synchronously here
        to satisfy the tool execution interface.
        """

        if not blueprint_path and not blueprint_id:
            return ToolResult.fail(
                "Either blueprint_path or blueprint_id is required",
                error_type="ValidationError",
            )

        if blueprint_id and not blueprint_path:
            found = self._find_blueprint_path(blueprint_id)
            if not found:
                return ToolResult.fail(
                    f"Blueprint with ID '{blueprint_id}' not found locally",
                    error_type="NotFound",
                )
            blueprint_path = found

        try:
            result = run_coro_sync(
                self.sync_manager.send_blueprint(blueprint_path),
                timeout=90,
            )
            content = (
                f"Sent blueprint: {result.get('blueprintId')}\n"
                f"version: {result.get('version')}\n"
                f"syncStatus: {result.get('syncStatus')}"
            )
            return ToolResult.ok_result(
                content,
                blueprintId=result.get("blueprintId"),
                version=result.get("version"),
                syncStatus=result.get("syncStatus"),
            )
        except Exception as e:
            return ToolResult.fail(f"Send failed: {e}", error_type="Exception")

    def _find_blueprint_path(self, blueprint_id: str) -> str | None:
        """Find blueprint file by ID."""
        blueprints_dir = Path("data/blueprints")

        for pattern in ("*.jarvis", "*.json"):
            for blueprint_file in blueprints_dir.glob(pattern):
                try:
                    import json

                    with open(blueprint_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if data.get("id") == blueprint_id:
                            return str(blueprint_file)
                except Exception:
                    continue

        return None
