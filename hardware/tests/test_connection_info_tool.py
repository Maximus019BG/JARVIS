"""Tests for ConnectionInfoTool."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.base_tool import ToolResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tool():
    """Import and instantiate the tool (avoids import-time side effects)."""
    from tools.connection_info_tool import ConnectionInfoTool
    return ConnectionInfoTool()


def _fake_jwt_token(payload: dict) -> str:
    """Build a fake JWT with the given payload (no signature verification)."""
    import base64, json
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"{header}.{body}.fakesig"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestConnectionInfoServerOnline:
    """Server reachable → full user/workstation details."""

    @patch("tools.connection_info_tool.build_sync_stack")
    @patch("tools.connection_info_tool.run_coro_sync")
    @patch("tools.connection_info_tool.get_config")
    def test_returns_full_info(self, mock_cfg, mock_run, mock_stack):
        mock_cfg.return_value.sync_api.base_url = "https://jarvisweb.cloud"

        stack = MagicMock()
        stack.device_token = "tok"
        stack.device_id = "dev-1"
        mock_stack.return_value = stack

        mock_run.return_value = {
            "user": {"name": "Max", "email": "max@example.com", "image": None},
            "workstation": {"id": "ws-1", "name": "My Workshop"},
            "device": {"id": "dev-1", "name": "rpi5", "lastSeenAt": "2026-03-06T12:00:00Z"},
        }

        tool = _make_tool()
        result = tool.execute()

        assert result.ok
        assert "Max" in result.content
        assert "max@example.com" in result.content
        assert "My Workshop" in result.content
        assert "rpi5" in result.content
        assert result.error_details["online"] is True


class TestConnectionInfoOfflineFallback:
    """Server unreachable → fallback to JWT-decoded claims."""

    @patch("tools.connection_info_tool.build_sync_stack")
    @patch("tools.connection_info_tool.run_coro_sync")
    @patch("tools.connection_info_tool.get_config")
    def test_offline_shows_jwt_claims(self, mock_cfg, mock_run, mock_stack):
        mock_cfg.return_value.sync_api.base_url = "http://localhost:3000"

        token = _fake_jwt_token({
            "deviceId": "dev-1",
            "workstationId": "ws-1",
            "userId": "user-1",
        })

        stack = MagicMock()
        stack.device_token = token
        stack.device_id = "dev-1"
        mock_stack.return_value = stack

        # Server unreachable
        mock_run.side_effect = ConnectionError("Connection refused")

        tool = _make_tool()
        result = tool.execute()

        assert result.ok
        assert "offline" in result.content.lower()
        assert "dev-1" in result.content
        assert "ws-1" in result.content
        assert "user-1" in result.content
        assert result.error_details["online"] is False


class TestConnectionInfoNotRegistered:
    """No device credentials → clear not-registered message."""

    @patch("tools.connection_info_tool.build_sync_stack")
    @patch("tools.connection_info_tool.get_config")
    def test_no_credentials(self, mock_cfg, mock_stack):
        mock_cfg.return_value.sync_api.base_url = "https://jarvisweb.cloud"

        # build_sync_stack raises when no token file exists
        mock_stack.side_effect = FileNotFoundError("data/device_token.enc")

        tool = _make_tool()
        result = tool.execute()

        assert result.ok
        assert "not connected" in result.content.lower()
        assert result.error_details["registered"] is False

    @patch("tools.connection_info_tool.build_sync_stack")
    @patch("tools.connection_info_tool.get_config")
    def test_empty_token(self, mock_cfg, mock_stack):
        mock_cfg.return_value.sync_api.base_url = "https://jarvisweb.cloud"

        stack = MagicMock()
        stack.device_token = ""
        stack.device_id = ""
        mock_stack.return_value = stack

        tool = _make_tool()
        result = tool.execute()

        assert result.ok
        assert "not connected" in result.content.lower()
        assert result.error_details["registered"] is False


class TestDecodeJwtPayload:
    """Unit tests for the JWT payload decoder."""

    def test_valid_token(self):
        from tools.connection_info_tool import _decode_jwt_payload

        token = _fake_jwt_token({"deviceId": "d1", "userId": "u1"})
        payload = _decode_jwt_payload(token)
        assert payload["deviceId"] == "d1"
        assert payload["userId"] == "u1"

    def test_garbage_token(self):
        from tools.connection_info_tool import _decode_jwt_payload

        assert _decode_jwt_payload("not.a.jwt.at.all") == {}
        assert _decode_jwt_payload("") == {}
        assert _decode_jwt_payload("x") == {}
