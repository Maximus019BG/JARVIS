"""Configuration management for the hardware app."""

from typing import Any, Dict

DEFAULT_THEME: Dict[str, str] = {
    "primary_color": "#007bff",
    "secondary_color": "#6c757d",
    "background_color": "#ffffff",
    "text_color": "#000000",
    "accent_color": "#28a745",
}

current_theme = DEFAULT_THEME.copy()

# Other configuration can be added here
