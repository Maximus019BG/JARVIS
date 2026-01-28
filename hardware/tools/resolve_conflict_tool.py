from __future__ import annotations

import asyncio
from typing import Any, Literal

from config.config import get_config
from core.base_tool import BaseTool, ToolResult
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.sync.sync_manager import SyncManager


class ResolveConflictTool(BaseTool):
    """Chat tool for resolving blueprint conflicts."""

    @property
    def name(self) -> str:
        return "resolve_conflict"

    @property
    def description(self) -> str:
        return "Resolve a sync conflict for a blueprint. Requires blueprint_id and resolution (server/local/merge)"

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
        self.sync_manager = SyncManager(self.http_client, self.device_token, self.device_id)

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
            return ToolResult.fail("blueprint_id is required", error_type="ValidationError")

        if resolution not in ("server", "local", "merge"):
            return ToolResult.fail(
                "resolution must be 'server', 'local', or 'merge'",
                error_type="ValidationError",
            )

        async def _run() -> dict[str, Any]:
            return await self.sync_manager.resolve_conflict(blueprint_id, str(resolution))

        try:
            result = asyncio.run(_run())
            content = (
                f"Resolved conflict for blueprint: {result.get('blueprintId')}\n"
                f"version: {result.get('version')}"
            )
            return ToolResult.ok_result(
                content,
                blueprintId=result.get("blueprintId"),
                version=result.get("version"),
            )
        except RuntimeError as e:
            return ToolResult.fail(f"Resolution failed: {e}", error_type="RuntimeError")
        except Exception as e:
            return ToolResult.fail(f"Resolution failed: {e}", error_type="Exception")