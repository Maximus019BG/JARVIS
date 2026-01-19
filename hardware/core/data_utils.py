"""Data persistence utilities for themes and profiles."""

import json
import os
from typing import Any, Dict

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
THEME_FILE = os.path.join(DATA_DIR, 'theme.json')
PROFILE_FILE = os.path.join(DATA_DIR, 'profile.json')


def ensure_data_dir():
    """Ensure the data directory exists."""
    os.makedirs(DATA_DIR, exist_ok=True)


def load_theme() -> Dict[str, str]:
    """Load custom theme from file."""
    ensure_data_dir()
    if os.path.exists(THEME_FILE):
        try:
            with open(THEME_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    # Return default if no saved theme
    DEFAULT_THEME = {
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
    return DEFAULT_THEME.copy()


def save_theme(theme: Dict[str, str]) -> None:
    """Save custom theme to file."""
    ensure_data_dir()
    with open(THEME_FILE, 'w') as f:
        json.dump(theme, f, indent=2)


def load_profile() -> Dict[str, str]:
    """Load user profile from file."""
    ensure_data_dir()
    if os.path.exists(PROFILE_FILE):
        try:
            with open(PROFILE_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    # Return empty profile
    return {"name": "", "email": ""}


def save_profile(profile: Dict[str, str]) -> None:
    """Save user profile to file."""
    ensure_data_dir()
    with open(PROFILE_FILE, 'w') as f:
        json.dump(profile, f, indent=2)
