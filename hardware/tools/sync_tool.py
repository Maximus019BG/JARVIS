from __future__ import annotations

import asyncio
from typing import Any

from config.config import get_config
from core.base_tool import BaseTool, ToolResult
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.sync.sync_manager import SyncManager


class SyncTool(BaseTool):
    """Chat tool for syncing blueprints to server."""

    @property
    def name(self) -> str:
        return "sync_blueprints"

    @property
    def description(self) -> str:
        return "Sync blueprints to the server to view latest updates"

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
