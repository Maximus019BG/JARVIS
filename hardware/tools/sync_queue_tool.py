from __future__ import annotations
from typing import Any, Literal

from core.base_tool import BaseTool, ToolResult
from core.sync.offline_queue import OfflineQueue
from core.sync.async_bridge import run_coro_sync
from core.sync.sync_factory import build_sync_stack


class SyncQueueTool(BaseTool):
    """Chat tool for managing offline sync queue."""

    @property
    def name(self) -> str:
        return "sync_queue"

    @property
    def description(self) -> str:
        return "View or process the offline sync queue. Actions: view, process, clear"

    def __init__(self):
        stack = build_sync_stack()
        self.security = stack.security
        self.http_client = stack.http_client
        self.device_token = stack.device_token
        self.device_id = stack.device_id
        self.sync_manager = stack.sync_manager
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

    def execute(
        self, action: Literal["view", "process", "clear"] | str = "view", **_: Any
    ) -> ToolResult:
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
            try:
                results = run_coro_sync(
                    self.sync_manager.process_offline_queue(),
                    timeout=120,
                )
                return ToolResult.ok_result(
                    f"Processed {len(results)} operations",
                    results=results,
                )
            except Exception as e:
                return ToolResult.fail(f"Process failed: {e}", error_type="Exception")

        return ToolResult.fail(
            f"Unknown action: {action}", error_type="ValidationError"
        )
