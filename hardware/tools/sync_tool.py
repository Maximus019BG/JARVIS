from __future__ import annotations
from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.sync.async_bridge import run_coro_sync
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
        self.device_id = stack.device_id
        self.sync_manager = stack.sync_manager

    def schema_parameters(self) -> dict[str, Any]:
        # No required params
        return {"type": "object", "properties": {}, "required": []}

    def execute(self, **_: Any) -> ToolResult:
        try:
            blueprints = run_coro_sync(self.sync_manager.sync_to_server(), timeout=90)
            msg = f"Synced {len(blueprints)} blueprints"
            return ToolResult.ok_result(msg, blueprints=blueprints)
        except Exception as e:
            return ToolResult.fail(f"Sync failed: {e}", error_type="Exception")
