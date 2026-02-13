from __future__ import annotations

import asyncio
from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.sync.sync_factory import build_sync_stack


class SyncTool(BaseTool):
    """Chat tool for syncing blueprints to server."""

    @property
    def name(self) -> str:
        return "sync_blueprints"

    @property
    def description(self) -> str:
        return "Sync blueprints to the server to view latest updates"

    def __init__(self):
        stack = build_sync_stack()
        self.security = stack.security
        self.http_client = stack.http_client
        self.device_token = stack.device_token
        self.device_id = stack.device_id
        self.sync_manager = stack.sync_manager

    def schema_parameters(self) -> dict[str, Any]:
        # No required params
        return {"type": "object", "properties": {}, "required": []}

    def execute(self, **_: Any) -> ToolResult:
        async def _run() -> list[dict[str, Any]]:
            return await self.sync_manager.sync_to_server()

        try:
            blueprints = asyncio.run(_run())
            msg = f"Synced {len(blueprints)} blueprints"
            return ToolResult.ok_result(msg, blueprints=blueprints)
        except RuntimeError as e:
            return ToolResult.fail(f"Sync failed: {e}", error_type="RuntimeError")
        except Exception as e:
            return ToolResult.fail(f"Sync failed: {e}", error_type="Exception")
