"""Data persistence utilities for themes and profiles."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from typing import Any

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
THEME_FILE = os.path.join(DATA_DIR, "theme.json")
PROFILE_FILE = os.path.join(DATA_DIR, "profile.json")


DEFAULT_THEME: dict[str, str] = {
    "primary": "#158c68",
    "secondary": "#a7f3d0",
    "background": "#171717",
    "surface": "#242323",
    "text_primary": "#f0fdf4",
    "text_secondary": "#a7f3d0",
    "accent": "#10b981",
    "error": "#ef4444",
    "border": "#4b5563",
}


def ensure_data_dir() -> None:
    """Ensure the data directory exists."""
    os.makedirs(DATA_DIR, exist_ok=True)


def _read_json_file(path: str) -> Any | None:
    """Read and parse a JSON file.

    Returns parsed JSON on success, or None on any IO/parse failure.
    """

    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, OSError) as e:
        # Keep fallback behavior but make it observable.
        logger.warning(
            "Failed to read/parse JSON; falling back",
            extra={"path": path, "reason": type(e).__name__},
            exc_info=True,
        )
        return None


def _atomic_write_json(path: str, data: Any) -> None:
    """Atomically write JSON to path.

    Writes to a temp file in the same directory then replaces the target.
    """

    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)

    tmp_path = None
    try:
        # NamedTemporaryFile on Windows cannot be replaced while open unless delete=False.
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=directory,
            prefix=os.path.basename(path) + ".",
            suffix=".tmp",
            delete=False,
        ) as tmp:
            tmp_path = tmp.name
            json.dump(data, tmp, indent=2, ensure_ascii=False)
            tmp.flush()
            os.fsync(tmp.fileno())

        os.replace(tmp_path, path)
    except OSError as e:
        logger.warning(
            "Failed to write JSON atomically",
            extra={"path": path, "reason": type(e).__name__},
            exc_info=True,
        )
        raise
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                # Best-effort cleanup only.
                pass


def _validate_theme(obj: Any) -> tuple[dict[str, str], bool]:
    """Validate and normalize a theme.

    Returns (theme, normalized) where normalized indicates adjustments were made.
    """

    merged = DEFAULT_THEME.copy()

    if obj is None:
        return merged, False

    if not isinstance(obj, dict):
        return merged, True

    normalized = False
    for k, v in obj.items():
        if k not in DEFAULT_THEME:
            normalized = True
            continue
        if isinstance(v, str):
            merged[k] = v
        else:
            normalized = True

    return merged, normalized


def _validate_profile(obj: Any) -> tuple[dict[str, str], bool]:
    """Validate and normalize a profile.

    Always returns a dict with keys: name, email.
    """

    normalized = False
    out = {"name": "", "email": ""}

    if obj is None:
        return out, False

    if not isinstance(obj, dict):
        return out, True

    name = obj.get("name", "")
    email = obj.get("email", "")

    if not isinstance(name, str):
        normalized = True
        name = ""
    if not isinstance(email, str):
        normalized = True
        email = ""

    out["name"] = name
    out["email"] = email

    # Unknown keys are intentionally ignored to keep payload minimal.
    if any(k not in ("name", "email") for k in obj.keys()):
        normalized = True

    return out, normalized


def load_theme() -> dict[str, str]:
    """Load custom theme from file."""
    ensure_data_dir()

    obj = _read_json_file(THEME_FILE) if os.path.exists(THEME_FILE) else None
    theme, normalized = _validate_theme(obj)
    if normalized and obj is not None:
        logger.warning(
            "Theme JSON required normalization; using merged defaults",
            extra={"path": THEME_FILE, "reason": "validation_error"},
        )
    return theme


def save_theme(theme: dict[str, str]) -> None:
    """Save custom theme to file."""
    ensure_data_dir()

    # Keep compatibility: accept dict-like payloads; validate/normalize rather than raising.
    normalized_theme, normalized = _validate_theme(theme)
    if normalized:
        logger.warning(
            "Theme payload required normalization before saving",
            extra={"path": THEME_FILE, "reason": "validation_error"},
        )

    _atomic_write_json(THEME_FILE, normalized_theme)


def load_profile() -> dict[str, str]:
    """Load user profile from file."""
    ensure_data_dir()

    obj = _read_json_file(PROFILE_FILE) if os.path.exists(PROFILE_FILE) else None
    profile, normalized = _validate_profile(obj)
    if normalized and obj is not None:
        logger.warning(
            "Profile JSON required normalization; using normalized result",
            extra={"path": PROFILE_FILE, "reason": "validation_error"},
        )
    return profile


def save_profile(profile: dict[str, str]) -> None:
    """Save user profile to file."""
    ensure_data_dir()

    normalized_profile, normalized = _validate_profile(profile)
    if normalized:
        logger.warning(
            "Profile payload required normalization before saving",
            extra={"path": PROFILE_FILE, "reason": "validation_error"},
        )

    _atomic_write_json(PROFILE_FILE, normalized_profile)
