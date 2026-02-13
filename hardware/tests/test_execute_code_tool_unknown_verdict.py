import sys
from types import ModuleType

import pytest


def _install_import_stubs(monkeypatch: pytest.MonkeyPatch) -> None:
    """Install minimal stubs to allow importing [`hardware.tools.execute_code_tool`](hardware/tools/execute_code_tool.py:1).

    These tests must not require real app wiring / LLM providers.
    """

    # Stub logger
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

    # Stub minimal core.base_tool
    #
    # Important: `hardware.tools.execute_code_tool` uses `ToolResult.ok_result()` / `ToolResult.fail()`.
    # In this repo those are `@staticmethod`s on the ToolResult *dataclass*.
    # This stub mirrors that interface so tests don't depend on real app wiring.
    fake_core = ModuleType("core")
    fake_base_tool = ModuleType("core.base_tool")

    # Ensure `from core.base_tool import ToolResult` returns a class that has the
    # expected factory methods (some imports may be cached across tests).
    monkeypatch.setitem(sys.modules, "core", fake_core)
    monkeypatch.setitem(sys.modules, "core.base_tool", fake_base_tool)

    class _BaseTool:  # pragma: no cover
        pass

    class _ToolError(Exception):  # pragma: no cover
        pass

    class _ToolResult:
        def __init__(
            self, ok: bool, result: str = "", error: str = "", error_type: str = ""
        ):
            self.ok = ok
            self.result = result
            self.error = error
            self.error_type = error_type

        @staticmethod
        def ok_result(result: str) -> "_ToolResult":
            return _ToolResult(ok=True, result=result)

        @staticmethod
        def fail(error: str, error_type: str = "") -> "_ToolResult":
            return _ToolResult(ok=False, error=error, error_type=error_type)

    # Assign attributes on the *module*, not on the class. Assigning on the class
    # would shadow `_ToolResult.ok_result` / `_ToolResult.fail` and break callers.
    fake_base_tool.BaseTool = _BaseTool  # type: ignore[attr-defined]
    fake_base_tool.ToolError = _ToolError  # type: ignore[attr-defined]
    fake_base_tool.ToolResult = _ToolResult  # type: ignore[attr-defined]

    # (module stubs inserted above before any potential imports)

    # Stub provider factory import chain (LLM must not be used)
    fake_provider_factory = ModuleType("core.llm.provider_factory")

    class _DummyLLMProviderFactory:
        @staticmethod
        def create_with_fallback():
            raise RuntimeError("LLMProviderFactory not available in unit test")

    fake_provider_factory.LLMProviderFactory = _DummyLLMProviderFactory  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "core.llm", ModuleType("core.llm"))
    monkeypatch.setitem(sys.modules, "core.llm.provider_factory", fake_provider_factory)


def test_unknown_verdict_blocks_execution_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_import_stubs(monkeypatch)

    from hardware.tools.execute_code_tool import PythonASTSecurityAnalyzer

    async def _fake_ai(self, code: str):
        return type(self).SecurityAnalysisResult("unknown", "stub unknown")  # type: ignore[attr-defined]

    # Easier: import the dataclass directly
    from hardware.tools.execute_code_tool import SecurityAnalysisResult

    async def _fake_ai2(self, code: str):
        return SecurityAnalysisResult("unknown", "stub unknown")

    monkeypatch.setattr(PythonASTSecurityAnalyzer, "_ai_security_verdict", _fake_ai2)

    analyzer = PythonASTSecurityAnalyzer(
        enable_ai=True, fail_closed_on_unknown_verdict=True
    )

    violations = analyzer.analyze("print(1)")
    assert violations
    assert any("unknown verdict" in v.lower() for v in violations)


def test_safe_verdict_allows_execution(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_import_stubs(monkeypatch)

    from hardware.tools.execute_code_tool import (
        ExecuteCodeTool,
        PythonASTSecurityAnalyzer,
        SecurityAnalysisResult,
    )

    async def _fake_ai(self, code: str):
        return SecurityAnalysisResult("safe", "stub safe")

    monkeypatch.setattr(PythonASTSecurityAnalyzer, "_ai_security_verdict", _fake_ai)

    tool = ExecuteCodeTool()
    res = tool.execute(code="print(1+1)", language="python")

    assert res.ok is True
    assert "2" in res.result


def test_dangerous_verdict_blocks_execution(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_import_stubs(monkeypatch)

    from hardware.tools.execute_code_tool import ExecuteCodeTool

    tool = ExecuteCodeTool()
    res = tool.execute(code='eval("2+2")', language="python")

    assert res.ok is False
    assert res.error_type == "SecurityViolation"


def test_flag_allows_unknown_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_import_stubs(monkeypatch)

    from hardware.tools.execute_code_tool import (
        PythonASTSecurityAnalyzer,
        SecurityAnalysisResult,
    )

    async def _fake_ai(self, code: str):
        return SecurityAnalysisResult("unknown", "stub unknown")

    monkeypatch.setattr(PythonASTSecurityAnalyzer, "_ai_security_verdict", _fake_ai)

    analyzer = PythonASTSecurityAnalyzer(
        enable_ai=True, fail_closed_on_unknown_verdict=False
    )
    violations = analyzer.analyze("print(1)")
    assert violations == []
