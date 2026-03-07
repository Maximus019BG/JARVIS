"""Tool to show which user / workstation the hardware device is connected to."""

from __future__ import annotations

import base64
import json
import os
from typing import Any

from app_logging.logger import get_logger
from config.config import get_config
from core.base_tool import BaseTool, ToolResult
from core.sync.async_bridge import run_coro_sync
from core.sync.sync_factory import build_sync_stack

logger = get_logger(__name__)

# Device name from .env (falls back to hostname)
DEVICE_NAME = os.getenv("DEVICE_NAME", "").strip()
if not DEVICE_NAME:
    import socket
    try:
        DEVICE_NAME = socket.gethostname()
    except Exception:
        DEVICE_NAME = "unknown"


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    """Decode the payload section of a JWT *without* verifying the signature.

    This is safe because we only use it to read our *own* locally-stored
    device token for offline display purposes.
    """
    try:
        # JWT structure: header.payload.signature
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        payload_b64 = parts[1]
        # Add padding if needed
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding
        decoded = base64.urlsafe_b64decode(payload_b64)
        return json.loads(decoded)
    except Exception:
        return {}


class ConnectionInfoTool(BaseTool):
    """Display connection info: which user and workstation this device is linked to."""

    @property
    def name(self) -> str:
        return "connection_info"

    @property
    def description(self) -> str:
        return "Show which user and workstation the hardware is currently connected to"

    def schema_parameters(self) -> dict[str, Any]:
        return {"type": "object", "properties": {}, "required": []}

    def execute(self, **_: Any) -> ToolResult:
        cfg = get_config()
        sync_url = cfg.sync_api.base_url

        # --- try to build the sync stack (loads device credentials) ----------
        try:
            stack = build_sync_stack()
        except Exception as exc:
            logger.warning("Cannot load device credentials: %s", exc)
            return ToolResult.ok_result(
                f"Not connected – device is not registered.\n"
                f"Device name:  {DEVICE_NAME}\n"
                f"Sync server:  {sync_url}\n"
                "Run device registration from the web dashboard first.",
                registered=False,
                sync_url=sync_url,
                device_name=DEVICE_NAME,
            )

        device_token = stack.device_token
        device_id = stack.device_id

        if not device_token or not device_id:
            return ToolResult.ok_result(
                f"Not connected – device credentials not found.\n"
                f"Device name:  {DEVICE_NAME}\n"
                f"Sync server:  {sync_url}\n"
                "Run device registration from the web dashboard first.",
                registered=False,
                sync_url=sync_url,
                device_name=DEVICE_NAME,
            )

        # --- try the server endpoint for full info ---------------------------
        try:
            response = run_coro_sync(
                stack.sync_manager.http.get(
                    "/api/workstation/device/me",
                    params={},
                    device_id=device_id,
                    device_token=device_token,
                ),
                timeout=15,
            )
            return self._format_server_response(response, sync_url, device_id)
        except Exception as exc:
            logger.debug("Server unreachable for /device/me: %s", exc)

        # --- fallback: decode JWT locally ------------------------------------
        claims = _decode_jwt_payload(device_token)
        return self._format_offline(claims, sync_url, device_id)

    # ------------------------------------------------------------------
    # Formatting helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _format_server_response(
        data: dict[str, Any], sync_url: str, device_id: str
    ) -> ToolResult:
        user_info = data.get("user") or {}
        ws_info = data.get("workstation") or {}
        dev_info = data.get("device") or {}

        lines = [
            "Connected to JARVIS cloud ✓",
            "",
            f"  Device name: {DEVICE_NAME}",
            f"  User:        {user_info.get('name', 'unknown')}",
            f"  Email:       {user_info.get('email', 'unknown')}",
            f"  Workstation: {ws_info.get('name', 'unknown')} ({ws_info.get('id', '?')})",
            f"  Device:      {dev_info.get('name', 'unknown')} ({dev_info.get('id', device_id)})",
            f"  Last seen:   {dev_info.get('lastSeenAt', 'just now')}",
            f"  Sync server: {sync_url}",
        ]

        return ToolResult.ok_result(
            "\n".join(lines),
            connected=True,
            online=True,
            user=user_info,
            workstation=ws_info,
            device=dev_info,
            sync_url=sync_url,
        )

    @staticmethod
    def _format_offline(
        claims: dict[str, Any], sync_url: str, device_id: str
    ) -> ToolResult:
        lines = [
            "Connected (offline mode)",
            "",
            f"  Device name:    {DEVICE_NAME}",
            f"  Device ID:      {claims.get('deviceId', device_id)}",
            f"  Workstation ID: {claims.get('workstationId', 'unknown')}",
            f"  User ID:        {claims.get('userId', 'unknown')}",
            f"  Sync server:    {sync_url} (unreachable)",
            "",
            "Full user details will be available when the server is reachable.",
        ]

        return ToolResult.ok_result(
            "\n".join(lines),
            connected=True,
            online=False,
            claims=claims,
            sync_url=sync_url,
        )
