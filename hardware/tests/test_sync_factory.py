"""Tests for core.sync.sync_factory – build_sync_stack."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestSyncStack:
    def test_dataclass_fields(self):
        from core.sync.sync_factory import SyncStack
        stack = SyncStack(
            security=MagicMock(),
            http_client=MagicMock(),
            device_token="tok",
            device_id="dev",
            sync_manager=MagicMock(),
        )
        assert stack.device_token == "tok"
        assert stack.device_id == "dev"

    def test_frozen(self):
        from core.sync.sync_factory import SyncStack
        stack = SyncStack(
            security=MagicMock(),
            http_client=MagicMock(),
            device_token="tok",
            device_id="dev",
            sync_manager=MagicMock(),
        )
        with pytest.raises(AttributeError):
            stack.device_token = "new"


class TestBuildSyncStack:
    @patch("core.sync.sync_factory.get_config")
    @patch("core.sync.sync_factory.HttpClient")
    @patch("core.sync.sync_factory.SyncManager")
    def test_builds_with_defaults(self, MockSyncMgr, MockHttp, mock_get_config):
        mock_cfg = MagicMock()
        mock_cfg.sync_api.base_url = "http://test.local"
        mock_get_config.return_value = mock_cfg

        sec = MagicMock()
        sec.load_device_token.return_value = "tok123"
        sec.load_device_id.return_value = "dev456"

        from core.sync.sync_factory import build_sync_stack
        stack = build_sync_stack(security=sec)

        assert stack.device_token == "tok123"
        assert stack.device_id == "dev456"
        MockHttp.assert_called_once_with(base_url="http://test.local", security_manager=sec)

    @patch("core.sync.sync_factory.HttpClient")
    @patch("core.sync.sync_factory.SyncManager")
    def test_builds_with_custom_url(self, MockSyncMgr, MockHttp):
        sec = MagicMock()
        sec.load_device_token.return_value = "t"
        sec.load_device_id.return_value = "d"

        from core.sync.sync_factory import build_sync_stack
        stack = build_sync_stack(security=sec, base_url="http://custom.local")

        MockHttp.assert_called_once_with(base_url="http://custom.local", security_manager=sec)

    @patch("core.sync.sync_factory.get_config")
    @patch("core.sync.sync_factory.SecurityManager")
    @patch("core.sync.sync_factory.HttpClient")
    @patch("core.sync.sync_factory.SyncManager")
    def test_creates_security_manager_if_none(self, MockSyncMgr, MockHttp, MockSec, mock_cfg):
        mock_cfg.return_value.sync_api.base_url = "http://x"
        mock_sec = MagicMock()
        mock_sec.load_device_token.return_value = "t"
        mock_sec.load_device_id.return_value = "d"
        MockSec.return_value = mock_sec

        from core.sync.sync_factory import build_sync_stack
        stack = build_sync_stack()

        MockSec.assert_called_once()
