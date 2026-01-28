from __future__ import annotations

import asyncio
from typing import Any, Literal

from config.config import get_config
from core.base_tool import BaseTool, ToolResult
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.sync.offline_queue import OfflineQueue
from core.sync.sync_manager import SyncManager


class SyncQueueTool(BaseTool):
    """Chat tool for managing offline sync queue."""

    @property
    def name(self) -> str:
        return "sync_queue"

    @property
    def description(self) -> str:
        return "View or process the offline sync queue. Actions: view, process, clear"

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
        self.queue = OfflineQueue()

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Queue action",
                    "enum": ["view", "process", "clear"],
                    "default": "view",
                }
            },
            "required": [],
        }

    def execute(self, action: Literal["view", "process", "clear"] | str = "view", **_: Any) -> ToolResult:
        if action == "view":
            operations = [
                {"type": op.get("type"), "timestamp": op.get("timestamp")}
                for op in getattr(self.queue, "queue", [])
            ]
            return ToolResult.ok_result(
                f"Queue size: {len(operations)}",
                queue_size=len(operations),
                operations=operations,
            )

        if action == "clear":
            self.queue.clear()
            return ToolResult.ok_result("Queue cleared")

        if action == "process":
            async def _run() -> list[dict[str, Any]]:
                return await self.sync_manager.process_offline_queue()

            try:
                results = asyncio.run(_run())
                return ToolResult.ok_result(
                    f"Processed {len(results)} operations",
                    results=results,
                )
            except RuntimeError as e:
                return ToolResult.fail(f"Process failed: {e}", error_type="RuntimeError")
            except Exception as e:
                return ToolResult.fail(f"Process failed: {e}", error_type="Exception")

        return ToolResult.fail(f"Unknown action: {action}", error_type="ValidationError")