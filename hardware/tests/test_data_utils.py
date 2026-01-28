"""Tests for hardened IO helpers in data_utils.

These tests validate:
- explicit UTF-8 encoding behavior (non-ASCII round-trip)
- atomic write semantics (os.replace usage)
- logging on parse failures
- basic validation/normalization

Public APIs must remain unchanged.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from unittest.mock import patch

import pytest

import core.data_utils as data_utils


@pytest.fixture(autouse=True)
def _temp_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Redirect data_utils to use a temporary data dir for isolation."""

    monkeypatch.setattr(data_utils, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(data_utils, "THEME_FILE", str(tmp_path / "theme.json"))
    monkeypatch.setattr(data_utils, "PROFILE_FILE", str(tmp_path / "profile.json"))


def test_profile_utf8_round_trip_non_ascii() -> None:
    profile = {"name": "Иван", "email": "ivan@example.com"}
    data_utils.save_profile(profile)

    loaded = data_utils.load_profile()
    assert loaded == profile


def test_theme_normalization_unknown_and_wrong_types_logs(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Mix of valid overrides, unknown keys, and wrong types.
    bad_theme = {
        "primary": "#000000",
        "secondary": 123,  # wrong type
        "unknown_key": "junk",
    }

    caplog.set_level(logging.WARNING)
    data_utils.save_theme(bad_theme)  # should normalize

    loaded = data_utils.load_theme()

    assert loaded["primary"] == "#000000"
    assert loaded["secondary"] == data_utils.DEFAULT_THEME["secondary"]
    # defaults always present
    for k in data_utils.DEFAULT_THEME:
        assert k in loaded

    assert any(
        "Theme payload required normalization" in r.message for r in caplog.records
    )


def test_load_profile_invalid_json_logs_and_falls_back(
    caplog: pytest.LogCaptureFixture, tmp_path: Path
) -> None:
    # Write invalid JSON directly.
    Path(data_utils.PROFILE_FILE).write_text("{not valid json", encoding="utf-8")

    caplog.set_level(logging.WARNING)
    loaded = data_utils.load_profile()

    assert loaded == {"name": "", "email": ""}
    assert any("Failed to read/parse JSON" in r.message for r in caplog.records)


def test_atomic_write_uses_os_replace() -> None:
    with patch.object(
        data_utils.os, "replace", wraps=data_utils.os.replace
    ) as replace_spy:
        data_utils.save_profile({"name": "Alice", "email": "alice@example.com"})
        assert replace_spy.call_count == 1


def test_atomic_write_failure_does_not_corrupt_existing_file(tmp_path: Path) -> None:
    # Create an existing valid file.
    existing = {"name": "Old", "email": "old@example.com"}
    Path(data_utils.PROFILE_FILE).write_text(json.dumps(existing), encoding="utf-8")

    # Force os.replace to fail so the temp file never becomes the target.
    def _boom(src: str, dst: str) -> None:
        raise OSError("replace failed")

    with patch.object(data_utils.os, "replace", side_effect=_boom):
        with pytest.raises(OSError):
            data_utils.save_profile({"name": "New", "email": "new@example.com"})

    # Ensure old content is still valid and unchanged.
    loaded = data_utils.load_profile()
    assert loaded == existing
