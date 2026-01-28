from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from config.config import get_config
from core.base_tool import BaseTool, ToolResult
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.sync.sync_manager import SyncManager


class SendBlueprintTool(BaseTool):
    """Chat tool for sending blueprints to server."""

    @property
    def name(self) -> str:
        return "send_blueprint"

    @property
    def description(self) -> str:
        return "Send a local blueprint to the server. Provide either blueprint_path or blueprint_id."

    def __init__(self):
        self.security = SecurityManager()

        # Security: base URL is now configured via environment/config, not hardcoded.
        cfg = get_config()
        self.http_client = HttpClient(
            base_url=cfg.sync_api.base_url,
            security_manager=self.security,
        )
        self.device_token = self.security.load_device_token()
        self.device_id = self.security.load_device_id()
        self.sync_manager = SyncManager(
            self.http_client, self.device_token, self.device_id
        )

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

        async def _run() -> dict[str, Any]:
            return await self.sync_manager.send_blueprint(blueprint_path)

        try:
            result = asyncio.run(_run())
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
        except RuntimeError as e:
            # event loop already running -> best effort
            return ToolResult.fail(f"Send failed: {e}", error_type="RuntimeError")
        except Exception as e:
            return ToolResult.fail(f"Send failed: {e}", error_type="Exception")

    def _find_blueprint_path(self, blueprint_id: str) -> str | None:
        """Find blueprint file by ID."""
        blueprints_dir = Path("data/blueprints")

        for blueprint_file in blueprints_dir.glob("*.json"):
            try:
                import json

                with open(blueprint_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("id") == blueprint_id:
                        return str(blueprint_file)
            except Exception:
                continue

        return None
