"""Tool to register this hardware device with a JARVIS cloud account.

Handles the full flow:
1. Prompt for email (passed by LLM), then prompt for password (masked in TUI)
2. Sign in with email + password (better-auth)
3. List workstations (pick first or user-specified)
4. Call /api/workstation/device/register
5. Store device credentials locally

The tool deliberately makes ``password`` optional so the LLM only passes
the email.  When password is missing the tool returns a special
``password_required`` result that the TUI picks up to switch the input
field to masked (dot) mode, collect the password, and re-invoke the tool.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from app_logging.logger import get_logger
from config.config import get_config
from core.base_tool import BaseTool, ToolResult
from core.security.security_manager import SecurityManager

logger = get_logger(__name__)

# Sentinel value placed in ToolResult.error_type so the TUI can detect
# that it needs to collect a masked password from the user.
PASSWORD_REQUIRED = "password_required"


class RegisterDeviceTool(BaseTool):
    """Register this hardware device with a JARVIS cloud user account."""

    @property
    def name(self) -> str:
        return "register_device"

    @property
    def description(self) -> str:
        return (
            "Register this device with your JARVIS cloud account. "
            "Provide the email — you will be prompted to enter the password securely."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "email": {
                    "type": "string",
                    "description": "Account email address",
                },
                "device_name": {
                    "type": "string",
                    "description": "Name for this device (default: hostname)",
                },
                "workstation_name": {
                    "type": "string",
                    "description": "Workstation name to register under (default: first available)",
                },
            },
            "required": ["email"],
        }

    def execute(
        self,
        email: str = "",
        password: str = "",
        device_name: str | None = None,
        workstation_name: str | None = None,
        **_: Any,
    ) -> ToolResult:
        if not email:
            return ToolResult.fail(
                "Email is required.",
                error_type="ValidationError",
            )

        # Phase 1: no password yet → ask TUI to collect it securely
        if not password:
            return ToolResult.fail(
                "Enter your password:",
                error_type=PASSWORD_REQUIRED,
                error_details={
                    "email": email,
                    "device_name": device_name,
                    "workstation_name": workstation_name,
                },
            )

        cfg = get_config()
        base_url = cfg.sync_api.base_url
        device_name = device_name or _default_device_name()

        try:
            return self._register(
                base_url, email, password, device_name, workstation_name
            )
        except httpx.ConnectError:
            return ToolResult.fail(
                f"Cannot reach sync server at {base_url}. Check SYNC_API_BASE_URL.",
                error_type="ConnectionError",
            )
        except Exception as exc:
            logger.exception("Device registration failed")
            return ToolResult.fail(
                f"Registration failed: {exc}",
                error_type="RegistrationError",
            )

    # ------------------------------------------------------------------

    def _register(
        self,
        base_url: str,
        email: str,
        password: str,
        device_name: str,
        workstation_name: str | None,
    ) -> ToolResult:
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            # ── 1. sign in ────────────────────────────────────────
            sign_in = client.post(
                f"{base_url}/api/auth/sign-in/email",
                json={"email": email, "password": password},
            )
            if sign_in.status_code != 200:
                body = (
                    sign_in.json()
                    if sign_in.headers.get("content-type", "").startswith(
                        "application/json"
                    )
                    else {}
                )
                msg = (
                    body.get("message") or body.get("error") or sign_in.text[:200]
                )
                return ToolResult.fail(
                    f"Sign-in failed ({sign_in.status_code}): {msg}",
                    error_type="AuthError",
                )

            # better-auth returns session cookies automatically
            # ── 2. list workstations ──────────────────────────────
            ws_resp = client.get(f"{base_url}/api/workstation/list")
            if ws_resp.status_code != 200:
                return ToolResult.fail(
                    f"Failed to list workstations ({ws_resp.status_code})",
                    error_type="ApiError",
                )

            workstations = ws_resp.json()
            if not workstations:
                return ToolResult.fail(
                    "No workstations found. Create one in the web dashboard first.",
                    error_type="NoWorkstation",
                )

            # Pick workstation
            ws = None
            if workstation_name:
                ws = next(
                    (
                        w
                        for w in workstations
                        if w.get("name", "").lower() == workstation_name.lower()
                    ),
                    None,
                )
                if ws is None:
                    names = ", ".join(w.get("name", "?") for w in workstations)
                    return ToolResult.fail(
                        f"Workstation '{workstation_name}' not found. Available: {names}",
                        error_type="NotFound",
                    )
            else:
                ws = workstations[0]

            workstation_id = ws["id"]
            workstation_name_actual = ws.get("name", workstation_id)

            # ── 3. register device ────────────────────────────────
            reg_resp = client.post(
                f"{base_url}/api/workstation/device/register",
                json={
                    "workstationId": workstation_id,
                    "deviceName": device_name,
                },
            )
            if reg_resp.status_code != 200:
                body = (
                    reg_resp.json()
                    if reg_resp.headers.get("content-type", "").startswith(
                        "application/json"
                    )
                    else {}
                )
                msg = body.get("error") or reg_resp.text[:200]
                return ToolResult.fail(
                    f"Device registration failed ({reg_resp.status_code}): {msg}",
                    error_type="ApiError",
                )

            data = reg_resp.json()
            device_id = data["deviceId"]
            device_token = data["deviceToken"]

            # ── 4. resolve HMAC signing key ───────────────────────
            signing_key = os.getenv("BLUEPRINT_SYNC_HMAC_SECRET", "")
            if not signing_key:
                logger.warning(
                    "BLUEPRINT_SYNC_HMAC_SECRET not set in .env — "
                    "sync request signing will fail until configured."
                )

            # ── 5. store credentials locally ──────────────────────
            sec = SecurityManager()
            sec.save_device_credentials(device_id, device_token, signing_key)

            lines = [
                "Device registered successfully!",
                "",
                f"  Email:       {email}",
                f"  Workstation: {workstation_name_actual} ({workstation_id})",
                f"  Device:      {device_name} ({device_id})",
                f"  Server:      {base_url}",
                "",
                "Credentials stored. Sync tools are now functional.",
            ]
            if not signing_key:
                lines.append(
                    "\nWarning: Set BLUEPRINT_SYNC_HMAC_SECRET in .env to enable signed requests."
                )

            return ToolResult.ok_result(
                "\n".join(lines),
                device_id=device_id,
                workstation_id=workstation_id,
                workstation_name=workstation_name_actual,
            )


def _default_device_name() -> str:
    """Best-effort hostname for the device name."""
    import socket

    try:
        return socket.gethostname()
    except Exception:
        return "jarvis-hardware"
