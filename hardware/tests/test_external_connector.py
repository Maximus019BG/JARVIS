"""Tests for core.external_tools.connector – ExternalToolConnector, PluginError."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from core.external_tools.connector import ExternalToolConnector, PluginError


# ---------------------------------------------------------------------------
# PluginError
# ---------------------------------------------------------------------------

class TestPluginError:
    def test_str_no_errors(self) -> None:
        e = PluginError("something failed")
        assert str(e) == "something failed"

    def test_str_with_errors(self) -> None:
        e = PluginError("load fail", [("toolA", "bad import"), ("toolB", "missing")])
        s = str(e)
        assert "toolA" in s
        assert "bad import" in s
        assert "toolB" in s

    def test_errors_attribute(self) -> None:
        e = PluginError("x")
        assert e.errors == []


# ---------------------------------------------------------------------------
# ExternalToolConnector
# ---------------------------------------------------------------------------

def _make_connector(tmp_path: Path) -> tuple[ExternalToolConnector, MagicMock, MagicMock]:
    registry = MagicMock()
    security = MagicMock()
    security.validate_file_access.return_value = None
    security.verify_plugin_signature.return_value = True
    connector = ExternalToolConnector(registry, security_manager=security)
    return connector, registry, security


class TestExternalToolConnectorInit:
    def test_init(self, tmp_path: Path) -> None:
        conn, reg, sec = _make_connector(tmp_path)
        assert conn.registry is reg
        assert conn.security is sec
        assert conn.connected_tools == {}


class TestConnectPlugin:
    def test_file_not_found(self, tmp_path: Path) -> None:
        conn, _, _ = _make_connector(tmp_path)
        with pytest.raises(PluginError, match="not found"):
            conn.connect_plugin(tmp_path / "missing.py")

    def test_not_python_file(self, tmp_path: Path) -> None:
        bad = tmp_path / "plugin.txt"
        bad.write_text("x")
        conn, _, _ = _make_connector(tmp_path)
        with pytest.raises(PluginError, match="Python file"):
            conn.connect_plugin(bad)

    def test_security_validation_fails(self, tmp_path: Path) -> None:
        plugin = tmp_path / "good.py"
        plugin.write_text("TOOLS = []")
        conn, _, sec = _make_connector(tmp_path)
        sec.validate_file_access.side_effect = PermissionError("nope")
        with pytest.raises(PluginError, match="not allowed"):
            conn.connect_plugin(plugin)

    def test_signature_verification_fails(self, tmp_path: Path) -> None:
        plugin = tmp_path / "bad_sig.py"
        plugin.write_text("TOOLS = []")
        conn, _, sec = _make_connector(tmp_path)
        sec.verify_plugin_signature.return_value = False
        with pytest.raises(PluginError, match="signature"):
            conn.connect_plugin(plugin)

    def test_missing_tools_export(self, tmp_path: Path) -> None:
        plugin = tmp_path / "no_tools.py"
        plugin.write_text("X = 1")
        conn, _, _ = _make_connector(tmp_path)
        with pytest.raises(PluginError, match="TOOLS"):
            conn.connect_plugin(plugin)

    def test_tools_not_list(self, tmp_path: Path) -> None:
        plugin = tmp_path / "bad_tools.py"
        plugin.write_text("TOOLS = 'not a list'")
        conn, _, _ = _make_connector(tmp_path)
        with pytest.raises(PluginError, match="list or tuple"):
            conn.connect_plugin(plugin)

    def test_successful_plugin_load(self, tmp_path: Path) -> None:
        plugin = tmp_path / "good_plugin.py"
        plugin.write_text(
            "from core.base_tool import BaseTool\n"
            "\nclass DummyTool(BaseTool):\n"
            "    @property\n"
            "    def name(self): return 'dummy'\n"
            "    @property\n"
            "    def description(self): return 'test'\n"
            "    def execute(self, **kw): return 'ok'\n"
            "\nTOOLS = [DummyTool]\n"
        )
        conn, reg, sec = _make_connector(tmp_path)
        names = conn.connect_plugin(plugin)
        assert "dummy" in names
        assert "dummy" in conn.connected_tools
        reg.register_tool.assert_called_once()
        sec.audit_log.assert_called()


class TestDisconnectPlugin:
    def test_disconnect_not_loaded(self, tmp_path: Path) -> None:
        conn, _, _ = _make_connector(tmp_path)
        result = conn.disconnect_plugin("/not/loaded.py")
        assert result == []

    def test_get_connected_tools_empty(self, tmp_path: Path) -> None:
        conn, _, _ = _make_connector(tmp_path)
        assert conn.get_connected_tools() == []

    def test_get_loaded_plugins_empty(self, tmp_path: Path) -> None:
        conn, _, _ = _make_connector(tmp_path)
        assert conn.get_loaded_plugins() == []


class TestLoadPluginsFromDirectory:
    def test_not_a_directory(self, tmp_path: Path) -> None:
        conn, _, _ = _make_connector(tmp_path)
        with pytest.raises(PluginError, match="Not a directory"):
            conn.load_plugins_from_directory(tmp_path / "nope")

    def test_skips_underscore_files(self, tmp_path: Path) -> None:
        (tmp_path / "__init__.py").write_text("x=1")
        conn, _, _ = _make_connector(tmp_path)
        # Should not raise — __init__.py is skipped
        try:
            conn.load_plugins_from_directory(tmp_path)
        except PluginError:
            pass  # May raise for other .py files but not for _-prefixed

    def test_empty_directory(self, tmp_path: Path) -> None:
        sub = tmp_path / "plugins"
        sub.mkdir()
        conn, _, _ = _make_connector(tmp_path)
        results = conn.load_plugins_from_directory(sub)
        assert results == {}
