"""Tests for CreateBlueprintTool security integration.

Notes:
- These tests should be run from the `hardware/` working directory (same as the
  existing suite), where imports like `core.*`/`tools.*` resolve.

Focused scope:
- Ensure CreateBlueprintTool routes file creation through the global SecurityManager
  via get_security_manager() and validate_file_access() before writing.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from core.security.security_manager import SecurityError
from tools.create_blueprint_tool import CreateBlueprintTool


class _FakeSecurityManager:
    def __init__(self):
        self.validate_calls: list[Path] = []
        self.sanitize_calls: list[str] = []
        self.validated_return: Path | None = None
        self.raise_exc: Exception | None = None
        self.sanitize_map: dict[str, str] = {}

    def sanitize_filename(self, filename: str) -> str:
        self.sanitize_calls.append(filename)
        return self.sanitize_map.get(filename, filename)

    def validate_file_access(self, path: str | Path) -> Path:
        self.validate_calls.append(Path(path))
        if self.raise_exc is not None:
            raise self.raise_exc
        assert self.validated_return is not None
        return self.validated_return


def test_create_blueprint_calls_validate_file_access_and_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fake = _FakeSecurityManager()

    # Ensure the tool writes to a temp location, not the repo.
    fake.validated_return = tmp_path / "data" / "blueprints" / "MyBlueprint.jarvis"

    import tools.create_blueprint_tool as mod

    monkeypatch.setattr(mod, "get_security_manager", lambda: fake)

    tool = CreateBlueprintTool()
    result = tool.execute(blueprint_name="MyBlueprint")

    assert result.ok is True
    assert len(fake.validate_calls) == 1
    assert fake.validate_calls[0] == Path("data") / "blueprints" / "MyBlueprint.jarvis"

    out_path = fake.validated_return
    assert out_path.exists()
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    # .jarvis format should have these fields
    assert "jarvis_version" in payload
    assert "type" in payload
    assert "name" in payload
    assert "components" in payload
    assert "connections" in payload
    assert "sync" in payload
    assert "security" in payload
    assert "hash" in payload
    assert payload["name"] == "MyBlueprint"


def test_create_blueprint_denied_path_returns_toolresult_fail(
    monkeypatch: pytest.MonkeyPatch,
):
    fake = _FakeSecurityManager()
    fake.raise_exc = SecurityError("Path not in allowed directories")

    import tools.create_blueprint_tool as mod

    monkeypatch.setattr(mod, "get_security_manager", lambda: fake)

    tool = CreateBlueprintTool()
    result = tool.execute(blueprint_name="MyBlueprint")

    assert result.ok is False
    assert result.error_type == "AccessDenied"
    assert "not in allowed" in result.content.lower()


def test_create_blueprint_uses_sanitized_filename_in_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fake = _FakeSecurityManager()
    fake.sanitize_map = {"../evil": "evil"}
    fake.validated_return = tmp_path / "data" / "blueprints" / "evil.jarvis"

    import tools.create_blueprint_tool as mod

    monkeypatch.setattr(mod, "get_security_manager", lambda: fake)

    tool = CreateBlueprintTool()
    result = tool.execute(blueprint_name="../evil")

    assert result.ok is True
    assert len(fake.validate_calls) == 1
    called_path = fake.validate_calls[0]
    assert called_path.name == "evil.jarvis"
    assert ".." not in str(called_path)

    assert fake.validated_return.exists()
