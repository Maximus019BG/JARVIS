from __future__ import annotations

from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.security.security_manager import SecurityManager
from core.sync.config_manager import SyncConfigManager
from core.sync.offline_queue import OfflineQueue


class SyncStatusTool(BaseTool):
    """Chat tool for viewing sync status."""

    @property
    def name(self) -> str:
        return "sync_status"

    @property
    def description(self) -> str:
        return "View current sync status and configuration"

    def __init__(self):
        self.config = SyncConfigManager()
        self.queue = OfflineQueue()
        self.security = SecurityManager()

    def schema_parameters(self) -> dict[str, Any]:
        return {"type": "object", "properties": {}, "required": []}

    def execute(self, **_: Any) -> ToolResult:
        device_registered = self.security.is_device_registered()
        last_sync = self.config.get_last_sync_timestamp()

        status = {
            "device_registered": device_registered,
            "device_id": self.security.load_device_id() if device_registered else None,
            "last_sync": last_sync,
            "sync_interval_minutes": self.config.get_sync_interval(),
            "conflict_resolution": self.config.get_conflict_resolution(),
            "auto_resolution_strategy": self.config.get_auto_resolution_strategy(),
            "offline_enabled": self.config.is_offline_enabled(),
            "queue_size": len(self.queue.queue),
            "queue_enabled": self.config.is_offline_enabled(),
        }

        lines = ["Sync status:"]
        for k, v in status.items():
            lines.append(f"- {k}: {v}")

        return ToolResult.ok_result("\n".join(lines), status=status)