"""Tool to list all devices registered to the current workstation."""

from __future__ import annotations

from typing import Any

from app_logging.logger import get_logger
from config.config import get_config
from core.base_tool import BaseTool, ToolResult
from core.sync.async_bridge import run_coro_sync
from core.sync.sync_factory import build_sync_stack

logger = get_logger(__name__)


class ListDevicesTool(BaseTool):
    """List all devices registered to the same workstation as this hardware."""

    @property
    def name(self) -> str:
        return "list_devices"

    @property
    def description(self) -> str:
        return "List all devices registered to your workstation"

    def schema_parameters(self) -> dict[str, Any]:
        return {"type": "object", "properties": {}, "required": []}

    def execute(self, **_: Any) -> ToolResult:
        cfg = get_config()
        sync_url = cfg.sync_api.base_url

        try:
            stack = build_sync_stack()
        except Exception as exc:
            logger.warning("Cannot load device credentials: %s", exc)
            return ToolResult.fail(
                "Device is not registered – cannot list devices.\n"
                f"Sync server: {sync_url}",
                error_type="NotRegistered",
            )

        device_token = stack.device_token
        device_id = stack.device_id

        if not device_token or not device_id:
            return ToolResult.fail(
                "Device credentials not found – cannot list devices.\n"
                f"Sync server: {sync_url}",
                error_type="NotRegistered",
            )

        try:
            response = run_coro_sync(
                stack.sync_manager.http.get(
                    "/api/workstation/device/list",
                    params={},
                    device_id=device_id,
                    device_token=device_token,
                ),
                timeout=15,
            )
        except Exception as exc:
            logger.debug("Server unreachable for /device/list: %s", exc)
            return ToolResult.fail(
                f"Cannot reach sync server at {sync_url}.\n"
                "Try again when the server is available.",
                error_type="ServerUnreachable",
            )

        devices = response.get("devices", [])
        if not devices:
            return ToolResult.ok_result(
                "No devices found for this workstation.",
                devices=[],
            )

        lines = [f"Devices in workstation ({len(devices)}):", ""]
        for dev in devices:
            current = " (this device)" if dev.get("isCurrent") else ""
            active = "active" if dev.get("isActive") else "inactive"
            last_seen = dev.get("lastSeenAt") or "never"
            lines.append(
                f"  • {dev.get('name', 'unnamed')}{current}\n"
                f"    ID: {dev.get('id', '?')}  |  {active}  |  last seen: {last_seen}"
            )

        return ToolResult.ok_result(
            "\n".join(lines),
            devices=devices,
        )
