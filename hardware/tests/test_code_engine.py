"""Tests for the Code Engine and RunScriptTool."""

from __future__ import annotations

import asyncio
import textwrap
from pathlib import Path

import pytest

from core.code.engine import CodeEngine, ExecutionResult
from tools.run_script_tool import RunScriptTool


# ── CodeEngine tests ─────────────────────────────────────────────────


class TestCodeEngine:
    """Core engine: save / load / list / run."""

    def _make_engine(self, tmp_path: Path) -> CodeEngine:
        return CodeEngine(code_dir=tmp_path, timeout=10)

    def test_save_script(self, tmp_path: Path):
        eng = self._make_engine(tmp_path)
        path = eng.save_script("hello", 'print("hello")')
        assert path.exists()
        assert path.name == "hello.py"
        assert eng.state.file_name == "hello.py"
        assert 'print("hello")' in eng.state.source

    def test_save_script_sanitises_name(self, tmp_path: Path):
        eng = self._make_engine(tmp_path)
        path = eng.save_script("my script! v2", "pass")
        assert path.name == "my_script_v2.py"

    def test_load_script(self, tmp_path: Path):
        eng = self._make_engine(tmp_path)
        (tmp_path / "test.py").write_text("x = 1\n")
        assert eng.load_script("test.py")
        assert eng.state.source == "x = 1\n"

    def test_load_nonexistent(self, tmp_path: Path):
        eng = self._make_engine(tmp_path)
        assert not eng.load_script("nope.py")

    def test_list_scripts(self, tmp_path: Path):
        eng = self._make_engine(tmp_path)
        (tmp_path / "a.py").write_text("pass")
        (tmp_path / "b.py").write_text("pass")
        (tmp_path / "c.txt").write_text("not python")
        scripts = eng.list_scripts()
        names = {p.name for p in scripts}
        assert "a.py" in names
        assert "b.py" in names
        assert "c.txt" not in names

    @pytest.mark.asyncio
    async def test_run_script_success(self, tmp_path: Path):
        eng = self._make_engine(tmp_path)
        eng.save_script("hi", 'print("hello world")')
        result = await eng.run_script()
        assert result.ok
        assert "hello world" in result.stdout
        assert result.return_code == 0

    @pytest.mark.asyncio
    async def test_run_script_error(self, tmp_path: Path):
        eng = self._make_engine(tmp_path)
        eng.save_script("bad", "raise ValueError('boom')")
        result = await eng.run_script()
        assert not result.ok
        assert "boom" in result.stderr

    @pytest.mark.asyncio
    async def test_run_script_timeout(self, tmp_path: Path):
        eng = CodeEngine(code_dir=tmp_path, timeout=1)
        eng.save_script("slow", "import time; time.sleep(10)")
        result = await eng.run_script()
        assert not result.ok
        assert result.timed_out

    @pytest.mark.asyncio
    async def test_run_inline(self, tmp_path: Path):
        eng = self._make_engine(tmp_path)
        result = await eng.run_inline("print(2 + 2)", name="math_test")
        assert result.ok
        assert "4" in result.stdout
        assert (tmp_path / "math_test.py").exists()

    @pytest.mark.asyncio
    async def test_run_no_script_loaded(self, tmp_path: Path):
        eng = self._make_engine(tmp_path)
        result = await eng.run_script()
        assert not result.ok
        assert "No script" in result.stderr


# ── ExecutionResult tests ────────────────────────────────────────────


class TestExecutionResult:
    def test_combined_output_both(self):
        r = ExecutionResult(ok=True, stdout="out", stderr="err", return_code=0)
        assert "out" in r.combined_output
        assert "err" in r.combined_output

    def test_combined_output_empty(self):
        r = ExecutionResult(ok=True, stdout="", stderr="", return_code=0)
        assert r.combined_output == "(no output)"

    def test_combined_output_timeout(self):
        r = ExecutionResult(ok=False, stdout="", stderr="", return_code=-1, timed_out=True)
        assert "timed out" in r.combined_output


# ── RunScriptTool tests ──────────────────────────────────────────────


class TestRunScriptTool:
    def test_schema(self):
        tool = RunScriptTool()
        assert tool.name == "run_script"
        schema = tool.schema_parameters()
        assert "name" in schema["properties"]
        assert "code" in schema["properties"]
        assert "run" in schema["properties"]

    def test_missing_name(self):
        tool = RunScriptTool()
        result = tool.execute(code="print(1)")
        assert not result.ok
        assert "name" in result.content.lower()

    def test_missing_code_opens_existing(self, tmp_path: Path, monkeypatch):
        """When code is omitted, the tool tries to load an existing script."""
        monkeypatch.setattr("core.code.engine.CODE_DIR", tmp_path)
        # No file exists → should fail with NotFound
        tool = RunScriptTool()
        result = tool.execute(name="nonexistent")
        assert not result.ok
        assert "not found" in result.content.lower()

    def test_open_existing_script(self, tmp_path: Path, monkeypatch):
        """Open and run an existing script by name (no code arg)."""
        monkeypatch.setattr("core.code.engine.CODE_DIR", tmp_path)
        # Pre-create the script
        (tmp_path / "greet.py").write_text('print("hello from greet")', encoding="utf-8")
        tool = RunScriptTool()
        result = tool.execute(name="greet")
        assert result.ok
        assert "hello from greet" in result.content
        assert result.error_details["open_code_engine"] is True
        assert "greet" in result.error_details["script_name"]

    def test_open_existing_with_py_suffix(self, tmp_path: Path, monkeypatch):
        """User can pass 'greet.py' and it still works."""
        monkeypatch.setattr("core.code.engine.CODE_DIR", tmp_path)
        (tmp_path / "greet.py").write_text('print("hey")', encoding="utf-8")
        tool = RunScriptTool()
        result = tool.execute(name="greet.py")
        assert result.ok

    def test_open_existing_no_run(self, tmp_path: Path, monkeypatch):
        """Open without running (run=False)."""
        monkeypatch.setattr("core.code.engine.CODE_DIR", tmp_path)
        (tmp_path / "calc.py").write_text("x = 42\nprint(x)", encoding="utf-8")
        tool = RunScriptTool()
        result = tool.execute(name="calc", run=False)
        assert result.ok
        assert "opened" in result.content.lower()
        # Source should have been loaded
        assert "x = 42" in result.error_details["source"]

    def test_save_and_run(self, tmp_path: Path, monkeypatch):
        """Test that the tool saves and runs a script."""
        # Monkeypatch the code dir to use tmp_path
        monkeypatch.setattr(
            "core.code.engine.CODE_DIR", tmp_path,
        )
        tool = RunScriptTool()
        result = tool.execute(name="hello", code='print("hi from test")')
        assert result.ok
        assert "hi from test" in result.content
        assert (tmp_path / "hello.py").exists()
        # Check metadata for TUI
        assert result.error_details["open_code_engine"] is True
        assert result.error_details["source"] == 'print("hi from test")'

    def test_save_without_run(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(
            "core.code.engine.CODE_DIR", tmp_path,
        )
        tool = RunScriptTool()
        result = tool.execute(name="norun", code="x = 1", run=False)
        assert result.ok
        assert "created" in result.content.lower()
        assert (tmp_path / "norun.py").exists()


# ── Code widget rendering tests ──────────────────────────────────────


class TestCodeWidgetRendering:
    """Test the rendering helpers (no TUI required)."""

    def test_render_source(self):
        from core.tui.code_widget import _render_source
        rendered = _render_source("x = 1\nprint(x)")
        assert "1│" in rendered
        assert "2│" in rendered

    def test_render_output_ok(self):
        from core.tui.code_widget import _render_output
        rendered = _render_output("42", ok=True)
        assert "42" in rendered

    def test_render_output_empty(self):
        from core.tui.code_widget import _render_output
        rendered = _render_output("")
        assert "no output" in rendered

    def test_syntax_highlight_comment(self):
        from core.tui.code_widget import _syntax_highlight_line
        rendered = _syntax_highlight_line("# this is a comment")
        assert "comment" in rendered.lower() or "green" in rendered.lower() or "#" in rendered
