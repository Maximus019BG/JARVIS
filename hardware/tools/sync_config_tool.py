from __future__ import annotations

from typing import Any, Literal

from core.base_tool import BaseTool, ToolResult
from core.sync.config_manager import SyncConfigManager


class SyncConfigTool(BaseTool):
    """Chat tool for configuring sync settings."""

    @property
    def name(self) -> str:
        return "sync_config"

    @property
    def description(self) -> str:
        return "Configure blueprint sync settings. Actions: get, set_interval, set_conflict, set_strategy, set_offline"

    def __init__(self):
        self.config = SyncConfigManager()

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "get",
                        "set_interval",
                        "set_conflict",
                        "set_strategy",
                        "set_offline",
                    ],
                    "default": "get",
                    "description": "Config action",
                },
                "interval": {
                    "type": "integer",
                    "description": "Sync interval minutes (for set_interval)",
                },
                "mode": {
                    "type": "string",
                    "enum": ["auto", "manual"],
                    "description": "Conflict resolution mode (for set_conflict)",
                },
                "strategy": {
                    "type": "string",
                    "enum": ["server", "local", "merge"],
                    "description": "Auto resolution strategy (for set_strategy)",
                },
                "offline": {
                    "type": "boolean",
                    "description": "Enable offline mode (for set_offline)",
                },
            },
            "required": [],
        }

    def execute(
        self,
        action: str = "get",
        interval: int | None = None,
        mode: Literal["auto", "manual"] | str | None = None,
        strategy: Literal["server", "local", "merge"] | str | None = None,
        offline: bool | None = None,
        **_: Any,
    ) -> ToolResult:
        if action == "get":
            cfg = {
                "sync_interval_minutes": self.config.get_sync_interval(),
                "conflict_resolution": self.config.get_conflict_resolution(),
                "auto_resolution_strategy": self.config.get_auto_resolution_strategy(),
                "offline_enabled": self.config.is_offline_enabled(),
            }
            lines = ["Sync config:"]
            for k, v in cfg.items():
                lines.append(f"- {k}: {v}")
            return ToolResult.ok_result("\n".join(lines), config=cfg)

        if action == "set_interval":
            if interval is None:
                return ToolResult.fail("interval parameter is required", error_type="ValidationError")
            self.config.set_sync_interval(interval)
            return ToolResult.ok_result(f"Sync interval set to {interval} minutes")

        if action == "set_conflict":
            if mode not in ("auto", "manual"):
                return ToolResult.fail("mode must be 'auto' or 'manual'", error_type="ValidationError")
            self.config.set_conflict_resolution(str(mode))
            return ToolResult.ok_result(f"Conflict resolution set to {mode}")

        if action == "set_strategy":
            if strategy not in ("server", "local", "merge"):
                return ToolResult.fail(
                    "strategy must be 'server', 'local', or 'merge'",
                    error_type="ValidationError",
                )
            self.config.set_auto_resolution_strategy(str(strategy))
            return ToolResult.ok_result(f"Auto resolution strategy set to {strategy}")

        if action == "set_offline":
            if offline is None:
                return ToolResult.fail("offline parameter is required", error_type="ValidationError")
            self.config.set_offline_enabled(bool(offline))
            return ToolResult.ok_result(f"Offline mode {'enabled' if offline else 'disabled'}")

        return ToolResult.fail(f"Unknown action: {action}", error_type="ValidationError")