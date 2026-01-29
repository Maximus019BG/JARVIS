from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from hardware.tools.shell_tool import ShellCommandTool


class _FakeSecurityManager:
    def __init__(self, allow: bool = True) -> None:
        self.allow = allow
        self.calls: list[str] = []

    def validate_file_access(self, path: str | Path) -> Path:
        self.calls.append(str(path))
        if not self.allow:
            raise Exception("denied")
        return Path(path).resolve()


def test_blocked_program_returns_security_violation() -> None:
    tool = ShellCommandTool()
    tool._security = _FakeSecurityManager(allow=True)  # type: ignore[attr-defined]

    result = tool.execute(program="powershell", args=["-NoProfile"])

    assert result.ok is False
    assert result.error_type == "SecurityViolation"


def test_allowlisted_command_builds_subprocess_args_correctly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tool = ShellCommandTool()
    tool._security = _FakeSecurityManager(allow=True)  # type: ignore[attr-defined]

    captured: dict[str, object] = {}

    def fake_run(argv, **kwargs):
        captured["argv"] = argv
        captured.update(kwargs)
        return subprocess.CompletedProcess(argv, 0, stdout="ok", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = tool.execute(program="echo", args=["hello"])

    assert result.ok is True
    assert captured["argv"] == ["echo", "hello"]
    assert captured["shell"] is False


def test_cwd_routed_through_security_manager_and_denies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tool = ShellCommandTool()
    sec = _FakeSecurityManager(allow=False)
    tool._security = sec  # type: ignore[attr-defined]

    def fake_run(*args, **kwargs):
        raise AssertionError("subprocess.run should not be called when cwd denied")

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = tool.execute(program="echo", args=["hi"], cwd="./hardware")

    assert result.ok is False
    assert result.error_type == "AccessDenied"
    assert sec.calls == ["./hardware"]


def test_metachar_injection_is_blocked_in_legacy_command() -> None:
    tool = ShellCommandTool()
    tool._security = _FakeSecurityManager(allow=True)  # type: ignore[attr-defined]

    result = tool.execute(command="echo hi && whoami")

    assert result.ok is False
    assert result.error_type == "SecurityViolation"


def test_path_operand_validation_called_for_cat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tool = ShellCommandTool()
    sec = _FakeSecurityManager(allow=True)
    tool._security = sec  # type: ignore[attr-defined]

    def fake_run(argv, **kwargs):
        return subprocess.CompletedProcess(argv, 0, stdout="ok", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = tool.execute(
        program="cat",
        args=["hardware/README.md"],
        cwd=str(Path(".").resolve()),
    )

    assert result.ok is True
    # One call for cwd, one call for operand
    assert any("README.md" in c for c in sec.calls)


def test_subprocess_timeout_returns_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    tool = ShellCommandTool(timeout=1)
    tool._security = _FakeSecurityManager(allow=True)  # type: ignore[attr-defined]

    def fake_run(argv, **kwargs):
        raise subprocess.TimeoutExpired(cmd=argv, timeout=kwargs.get("timeout", 1))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = tool.execute(program="echo", args=["hi"], timeout_seconds=1)

    assert result.ok is False
    assert result.error_type == "Timeout"
