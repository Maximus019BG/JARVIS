from __future__ import annotations

import pytest

from hardware.tools.edit_profile_tool import EditProfileTool
from hardware.tools.save_profile_tool import SaveProfileTool


def test_save_profile_merges_and_does_not_wipe_missing_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved: dict[str, str] = {}

    def fake_load_profile() -> dict[str, str]:
        return {"name": "Alice", "email": "alice@example.com"}

    def fake_save_profile(profile: dict[str, str]) -> None:
        saved.clear()
        saved.update(profile)

    monkeypatch.setattr(
        "hardware.tools.save_profile_tool.load_profile",
        fake_load_profile,
        raising=False,
    )
    monkeypatch.setattr(
        "hardware.tools.save_profile_tool.save_profile", fake_save_profile, raising=True
    )

    tool = SaveProfileTool()
    result = tool.execute(name="Bob")

    assert result.ok is True
    assert saved == {"name": "Bob", "email": "alice@example.com"}


def test_save_profile_clear_flags_wipe_explicitly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved: dict[str, str] = {}

    def fake_load_profile() -> dict[str, str]:
        return {"name": "Alice", "email": "alice@example.com"}

    def fake_save_profile(profile: dict[str, str]) -> None:
        saved.clear()
        saved.update(profile)

    monkeypatch.setattr(
        "hardware.tools.save_profile_tool.load_profile",
        fake_load_profile,
        raising=False,
    )
    monkeypatch.setattr(
        "hardware.tools.save_profile_tool.save_profile", fake_save_profile, raising=True
    )

    tool = SaveProfileTool()
    result = tool.execute(clear_email=True)

    assert result.ok is True
    assert saved == {"name": "Alice", "email": ""}


def test_save_profile_validation_whitespace_name_is_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Ensure no write happens on validation failure
    def fake_save_profile(profile: dict[str, str]) -> None:
        raise AssertionError("save_profile should not be called on validation error")

    monkeypatch.setattr(
        "hardware.tools.save_profile_tool.save_profile", fake_save_profile, raising=True
    )

    tool = SaveProfileTool()
    result = tool.execute(name="   ")

    assert result.ok is False
    assert result.error_type == "ValidationError"


def test_save_profile_validation_invalid_email_is_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Ensure no write happens on validation failure
    def fake_save_profile(profile: dict[str, str]) -> None:
        raise AssertionError("save_profile should not be called on validation error")

    monkeypatch.setattr(
        "hardware.tools.save_profile_tool.save_profile", fake_save_profile, raising=True
    )

    tool = SaveProfileTool()
    result = tool.execute(email="not-an-email")

    assert result.ok is False
    assert result.error_type == "ValidationError"


def test_edit_profile_whitespace_only_is_treated_as_not_provided(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_load_profile() -> dict[str, str]:
        return {"name": "Alice", "email": "alice@example.com"}

    def fake_save_profile(profile: dict[str, str]) -> None:
        raise AssertionError(
            "save_profile should not be called when nothing is provided"
        )

    monkeypatch.setattr(
        "hardware.tools.edit_profile_tool.load_profile", fake_load_profile, raising=True
    )
    monkeypatch.setattr(
        "hardware.tools.edit_profile_tool.save_profile", fake_save_profile, raising=True
    )

    tool = EditProfileTool()
    result = tool.execute(name="   ", email="\n\t")

    assert result.ok is False
    assert result.error_type == "ValidationError"


def test_edit_profile_trims_and_updates_only_provided_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved: dict[str, str] = {}

    def fake_load_profile() -> dict[str, str]:
        return {"name": "Alice", "email": "alice@example.com"}

    def fake_save_profile(profile: dict[str, str]) -> None:
        saved.clear()
        saved.update(profile)

    monkeypatch.setattr(
        "hardware.tools.edit_profile_tool.load_profile", fake_load_profile, raising=True
    )
    monkeypatch.setattr(
        "hardware.tools.edit_profile_tool.save_profile", fake_save_profile, raising=True
    )

    tool = EditProfileTool()
    result = tool.execute(name="  Bob  ")

    assert result.ok is True
    assert saved == {"name": "Bob", "email": "alice@example.com"}


def test_edit_profile_validation_invalid_email_is_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_load_profile() -> dict[str, str]:
        return {"name": "Alice", "email": "alice@example.com"}

    def fake_save_profile(profile: dict[str, str]) -> None:
        raise AssertionError("save_profile should not be called on validation error")

    monkeypatch.setattr(
        "hardware.tools.edit_profile_tool.load_profile", fake_load_profile, raising=True
    )
    monkeypatch.setattr(
        "hardware.tools.edit_profile_tool.save_profile", fake_save_profile, raising=True
    )

    tool = EditProfileTool()
    result = tool.execute(email="bad")

    assert result.ok is False
    assert result.error_type == "ValidationError"
