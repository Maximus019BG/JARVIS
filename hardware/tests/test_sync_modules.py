"""Tests for sync modules: SyncConfigManager, ConflictResolver, OfflineQueue."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ── SyncConfigManager ───────────────────────────────────────────────


class TestSyncConfigManager:
    @pytest.fixture(autouse=True)
    def _patch_path(self, tmp_path: Path) -> None:
        self.cfg_file = tmp_path / "sync_config.json"
        patcher = patch(
            "core.sync.config_manager.SyncConfigManager.CONFIG_PATH", self.cfg_file
        )
        patcher.start()
        yield
        patcher.stop()

    def _make(self):
        from core.sync.config_manager import SyncConfigManager
        return SyncConfigManager()

    def test_defaults(self) -> None:
        mgr = self._make()
        assert mgr.get_sync_interval() == 5
        assert mgr.get_conflict_resolution() == "auto"
        assert mgr.get_auto_resolution_strategy() == "server"
        assert mgr.is_offline_enabled() is True
        assert mgr.get_last_sync_timestamp() is None

    def test_set_sync_interval(self) -> None:
        mgr = self._make()
        mgr.set_sync_interval(10)
        assert mgr.get_sync_interval() == 10
        assert self.cfg_file.exists()

    def test_sync_interval_min_clamp(self) -> None:
        mgr = self._make()
        mgr.set_sync_interval(0)
        assert mgr.get_sync_interval() == 1

    def test_set_conflict_resolution(self) -> None:
        mgr = self._make()
        mgr.set_conflict_resolution("manual")
        assert mgr.get_conflict_resolution() == "manual"

    def test_set_auto_resolution_strategy(self) -> None:
        mgr = self._make()
        mgr.set_auto_resolution_strategy("merge")
        assert mgr.get_auto_resolution_strategy() == "merge"

    def test_set_offline_enabled(self) -> None:
        mgr = self._make()
        mgr.set_offline_enabled(False)
        assert mgr.is_offline_enabled() is False

    def test_update_last_sync(self) -> None:
        mgr = self._make()
        mgr.update_last_sync_timestamp()
        assert mgr.get_last_sync_timestamp() is not None

    def test_load_from_file(self) -> None:
        self.cfg_file.parent.mkdir(parents=True, exist_ok=True)
        self.cfg_file.write_text(json.dumps({"sync_interval_minutes": 42}))
        mgr = self._make()
        assert mgr.get_sync_interval() == 42


# ── ConflictResolver ────────────────────────────────────────────────


class TestConflictResolver:
    def _make(self, mode: str = "auto", strategy: str = "server"):
        from core.sync.config_manager import SyncConfigManager
        from core.sync.conflict_resolver import ConflictResolver

        cfg = MagicMock(spec=SyncConfigManager)
        cfg.get_conflict_resolution.return_value = mode
        cfg.get_auto_resolution_strategy.return_value = strategy
        return ConflictResolver(cfg)

    def test_auto_server(self) -> None:
        cr = self._make("auto", "server")
        result = cr.resolve({"a": 1}, {"b": 2}, "bp1")
        assert result == {"b": 2}

    def test_auto_local(self) -> None:
        cr = self._make("auto", "local")
        result = cr.resolve({"a": 1}, {"b": 2}, "bp1")
        assert result == {"a": 1}

    def test_auto_merge(self) -> None:
        cr = self._make("auto", "merge")
        local = {"x": 1, "version": 2}
        server = {"y": 2, "version": 3}
        result = cr.resolve(local, server, "bp1")
        assert result["x"] == 1
        assert result["y"] == 2
        assert result["version"] == 4  # max(2,3)+1

    def test_merge_nested(self) -> None:
        cr = self._make("auto", "merge")
        local = {"nested": {"a": 1}, "version": 1}
        server = {"nested": {"b": 2}, "version": 1}
        result = cr.resolve(local, server, "bp1")
        assert result["nested"]["a"] == 1
        assert result["nested"]["b"] == 2

    def test_manual(self) -> None:
        cr = self._make("manual")
        result = cr.resolve({"a": 1, "version": 5}, {"b": 2, "version": 6}, "bp1")
        assert result["conflict"] is True
        assert result["blueprintId"] == "bp1"
        assert result["localVersion"] == 5
        assert result["serverVersion"] == 6


# ── OfflineQueue ─────────────────────────────────────────────────────


class TestOfflineQueue:
    @pytest.fixture(autouse=True)
    def _patch_path(self, tmp_path: Path) -> None:
        self.q_file = tmp_path / "offline_queue.json"
        patcher = patch(
            "core.sync.offline_queue.OfflineQueue.QUEUE_PATH", self.q_file
        )
        patcher.start()
        yield
        patcher.stop()

    def _make(self, max_size: int = 100):
        from core.sync.offline_queue import OfflineQueue
        return OfflineQueue(max_size=max_size)

    def test_empty(self) -> None:
        q = self._make()
        assert q.is_empty()
        assert q.pop() is None

    def test_add_pop(self) -> None:
        q = self._make()
        q.add("update", {"id": "1"})
        assert not q.is_empty()
        op = q.pop()
        assert op["type"] == "update"
        assert op["data"]["id"] == "1"
        assert "timestamp" in op
        assert q.is_empty()

    def test_fifo_order(self) -> None:
        q = self._make()
        q.add("a", {})
        q.add("b", {})
        assert q.pop()["type"] == "a"
        assert q.pop()["type"] == "b"

    def test_eviction(self) -> None:
        q = self._make(max_size=2)
        q.add("first", {})
        q.add("second", {})
        q.add("third", {})  # should evict "first"
        assert q.pop()["type"] == "second"

    def test_clear(self) -> None:
        q = self._make()
        q.add("x", {})
        q.clear()
        assert q.is_empty()

    def test_persistence(self) -> None:
        q1 = self._make()
        q1.add("persisted", {"v": 42})
        # Create a new instance reading the same file
        q2 = self._make()
        op = q2.pop()
        assert op["type"] == "persisted"
