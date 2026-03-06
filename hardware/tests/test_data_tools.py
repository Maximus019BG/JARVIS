"""Tests for list_data and search_data tools."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest


# ---------- helpers ----------

@pytest.fixture()
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Set up a temporary data/ tree and patch tools to use it."""
    code_dir = tmp_path / "data" / "code"
    bp_dir = tmp_path / "data" / "blueprints"
    code_dir.mkdir(parents=True)
    bp_dir.mkdir(parents=True)

    # Create sample code files
    (code_dir / "hello.py").write_text(
        '"""Say hello."""\nprint("Hello, world!")\n', encoding="utf-8"
    )
    (code_dir / "calculator.py").write_text(
        "# A basic calculator\ndef add(a, b):\n    return a + b\nprint(add(2, 3))\n",
        encoding="utf-8",
    )

    # Create sample blueprint files
    bp = {
        "name": "Test Circuit",
        "type": "circuit",
        "description": "A simple battery-bulb circuit",
        "components": [
            {"name": "battery", "type": "battery", "position": [10, 50, 0]},
            {"name": "bulb", "type": "bulb", "position": [70, 50, 0]},
        ],
        "lines": [{"from": "battery", "to": "bulb", "label": "wire1"}],
    }
    (bp_dir / "test_circuit.jarvis").write_text(
        json.dumps(bp), encoding="utf-8"
    )

    bp2 = {
        "name": "Floor Plan",
        "type": "floor_plan",
        "description": "My bedroom layout",
        "components": [
            {"name": "bed", "type": "furniture", "position": [30, 40, 0]},
        ],
        "lines": [],
    }
    (bp_dir / "bedroom.jarvis").write_text(
        json.dumps(bp2), encoding="utf-8"
    )

    # Monkey-patch _DATA_ROOT in both modules
    monkeypatch.chdir(tmp_path)
    import tools.list_data_tool as ldt
    import tools.search_data_tool as sdt

    monkeypatch.setattr(ldt, "_DATA_ROOT", tmp_path / "data")
    monkeypatch.setattr(sdt, "_DATA_ROOT", tmp_path / "data")

    return tmp_path / "data"


# =====================================================================
# list_data tests
# =====================================================================

class TestListDataTool:
    """Tests for ListDataTool."""

    def _make(self):
        from tools.list_data_tool import ListDataTool
        return ListDataTool()

    def test_schema(self):
        tool = self._make()
        assert tool.name == "list_data"
        schema = tool.get_schema()
        assert schema["function"]["name"] == "list_data"

    def test_list_all(self, data_dir: Path):
        tool = self._make()
        result = tool.execute(category="all")
        assert result.ok
        assert "hello.py" in result.content
        assert "calculator.py" in result.content
        assert "test_circuit.jarvis" in result.content
        assert "bedroom.jarvis" in result.content

    def test_list_code_only(self, data_dir: Path):
        tool = self._make()
        result = tool.execute(category="code")
        assert result.ok
        assert "hello.py" in result.content
        assert "calculator.py" in result.content
        assert "jarvis" not in result.content.lower() or "code" in result.content.lower()

    def test_list_blueprints_only(self, data_dir: Path):
        tool = self._make()
        result = tool.execute(category="blueprints")
        assert result.ok
        assert "test_circuit.jarvis" in result.content
        assert "hello.py" not in result.content

    def test_list_code_summaries(self, data_dir: Path):
        """Code files should show first comment or docstring."""
        tool = self._make()
        result = tool.execute(category="code")
        assert result.ok
        # hello.py has a docstring "Say hello."
        assert "Say hello" in result.content
        # calculator.py has a comment "A basic calculator"
        assert "basic calculator" in result.content

    def test_list_blueprint_summaries(self, data_dir: Path):
        """Blueprint files should show name, type, component count."""
        tool = self._make()
        result = tool.execute(category="blueprints")
        assert result.ok
        assert "Test Circuit" in result.content
        assert "circuit" in result.content
        assert "2 component" in result.content

    def test_empty_dir(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        """Empty directories should report as empty."""
        import tools.list_data_tool as ldt

        empty = tmp_path / "data"
        (empty / "code").mkdir(parents=True)
        (empty / "blueprints").mkdir(parents=True)
        monkeypatch.setattr(ldt, "_DATA_ROOT", empty)

        tool = self._make()
        result = tool.execute(category="all")
        assert result.ok
        assert "empty" in result.content.lower()

    def test_missing_dir(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        """Non-existent data dir should not crash."""
        import tools.list_data_tool as ldt

        monkeypatch.setattr(ldt, "_DATA_ROOT", tmp_path / "missing")

        tool = self._make()
        result = tool.execute(category="all")
        assert result.ok
        assert "does not exist" in result.content or "empty" in result.content.lower()

    def test_invalid_category_defaults_to_all(self, data_dir: Path):
        tool = self._make()
        result = tool.execute(category="nonsense")
        assert result.ok
        assert "hello.py" in result.content

    def test_default_category_is_all(self, data_dir: Path):
        tool = self._make()
        result = tool.execute()
        assert result.ok
        assert "code" in result.content.lower()
        assert "blueprints" in result.content.lower()


# =====================================================================
# search_data tests
# =====================================================================

class TestSearchDataTool:
    """Tests for SearchDataTool."""

    def _make(self):
        from tools.search_data_tool import SearchDataTool
        return SearchDataTool()

    def test_schema(self):
        tool = self._make()
        assert tool.name == "search_data"
        schema = tool.get_schema()
        assert schema["function"]["name"] == "search_data"

    def test_search_code_keyword(self, data_dir: Path):
        """Should find 'calculator' inside code files."""
        tool = self._make()
        result = tool.execute(query="calculator", category="code")
        assert result.ok
        assert "calculator.py" in result.content

    def test_search_blueprint_component(self, data_dir: Path):
        """Should find 'battery' inside blueprint components."""
        tool = self._make()
        result = tool.execute(query="battery", category="blueprints")
        assert result.ok
        assert "test_circuit.jarvis" in result.content
        assert "battery" in result.content.lower()

    def test_search_all(self, data_dir: Path):
        """Search across both categories."""
        tool = self._make()
        result = tool.execute(query="print", category="all")
        assert result.ok
        # Both code files use print()
        assert "hello.py" in result.content
        assert "calculator.py" in result.content

    def test_search_case_insensitive(self, data_dir: Path):
        tool = self._make()
        result = tool.execute(query="HELLO")
        assert result.ok
        assert "hello.py" in result.content

    def test_search_no_matches(self, data_dir: Path):
        tool = self._make()
        result = tool.execute(query="xyznonexistent")
        assert result.ok
        assert "No match" in result.content

    def test_search_empty_query_fails(self, data_dir: Path):
        tool = self._make()
        result = tool.execute(query="")
        assert not result.ok
        assert "required" in result.content.lower()

    def test_search_blueprint_description(self, data_dir: Path):
        """Search matching blueprint description field."""
        tool = self._make()
        result = tool.execute(query="bedroom", category="blueprints")
        assert result.ok
        assert "bedroom.jarvis" in result.content

    def test_search_code_line_numbers(self, data_dir: Path):
        """Results should include line numbers."""
        tool = self._make()
        result = tool.execute(query="def add", category="code")
        assert result.ok
        assert "L" in result.content  # e.g. "L2: def add(a, b):"

    def test_search_blueprint_line_labels(self, data_dir: Path):
        """Should find matches in blueprint lines/connections."""
        tool = self._make()
        result = tool.execute(query="wire1", category="blueprints")
        assert result.ok
        assert "wire1" in result.content

    def test_search_missing_query_kwarg(self, data_dir: Path):
        tool = self._make()
        result = tool.execute()
        assert not result.ok

    def test_invalid_category_defaults_to_all(self, data_dir: Path):
        tool = self._make()
        result = tool.execute(query="print", category="bogus")
        assert result.ok
