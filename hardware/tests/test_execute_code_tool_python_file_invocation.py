import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest


def test_execute_python_file_uses_sys_executable_and_passes_args_timeout_cwd(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # execute_code_tool.py has heavy import-time initialization that can fail
    # in some environments. Keep this test focused on subprocess invocation by:
    # - providing minimal stubs for required imports
    # - stubbing re.compile to avoid import-time regex compilation failures
    fake_logger_module = ModuleType("app_logging.logger")

    def _get_logger(_name: str):
        class _L:
            def info(self, *args, **kwargs):
                pass

            def warning(self, *args, **kwargs):
                pass

            def error(self, *args, **kwargs):
                pass

        return _L()

    fake_logger_module.get_logger = _get_logger  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "app_logging", ModuleType("app_logging"))
    monkeypatch.setitem(sys.modules, "app_logging.logger", fake_logger_module)

    import re as _re

    def _safe_compile(pattern, flags=0):  # pragma: no cover
        # Return a harmless placeholder object; the test doesn't rely on regexes.
        return object()

    monkeypatch.setattr(_re, "compile", _safe_compile)

    # Stub minimal `core.base_tool` so we can import the tool module.
    fake_core = ModuleType("core")
    fake_base_tool = ModuleType("core.base_tool")

    class _BaseTool:  # pragma: no cover
        pass

    class _ToolError(Exception):  # pragma: no cover
        pass

    class _ToolResult:  # pragma: no cover
        pass

    fake_base_tool.BaseTool = _BaseTool  # type: ignore[attr-defined]
    fake_base_tool.ToolError = _ToolError  # type: ignore[attr-defined]
    fake_base_tool.ToolResult = _ToolResult  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "core", fake_core)
    monkeypatch.setitem(sys.modules, "core.base_tool", fake_base_tool)

    # Stub provider factory import chain to avoid optional dependency failures
    # (e.g. config/pydantic) during import of ExecuteCodeTool.
    fake_provider_factory = ModuleType("core.llm.provider_factory")

    class _DummyLLMProviderFactory:
        @staticmethod
        def create_with_fallback():
            raise RuntimeError("LLMProviderFactory not available in unit test")

    fake_provider_factory.LLMProviderFactory = _DummyLLMProviderFactory  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "core.llm", ModuleType("core.llm"))
    monkeypatch.setitem(sys.modules, "core.llm.provider_factory", fake_provider_factory)

    from hardware.tools.execute_code_tool import ExecuteCodeTool

    tool = ExecuteCodeTool(timeout=123)

    script_path = tmp_path / "script.py"
    script_path.write_text("print('ok')\n", encoding="utf-8")

    captured: dict[str, object] = {}

    def fake_run(argv, **kwargs):
        captured["argv"] = argv
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(argv, 0, stdout="ok\n", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    out = tool._execute_python_file(script_path, ["--flag", "value"])

    assert "Python file" in out

    argv = captured["argv"]
    assert isinstance(argv, list)
    assert argv[0] == sys.executable
    assert argv[1] == str(script_path)
    assert argv[2:] == ["--flag", "value"]

    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["timeout"] == 123
    assert kwargs["cwd"] == script_path.parent
    assert kwargs["capture_output"] is True
    assert kwargs["text"] is True
