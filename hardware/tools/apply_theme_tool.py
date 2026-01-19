"""Tool to apply theme changes."""

import re
from typing import Dict, List

from core.base_tool import BaseTool
from core.data_utils import load_theme, save_theme

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


def is_valid_hex_color(color: str) -> bool:
    """Validate hex color format (e.g., #2563eb or #0f8)."""
    return bool(re.match(r'^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$', color))


class ApplyThemeTool(BaseTool):
    """Tool for applying theme settings."""

    @property
    def name(self) -> str:
        return "apply_theme"

    @property
    def description(self) -> str:
        return "Applies a new theme with specified colors."

    def execute(self, primary: str = "", secondary: str = "", background: str = "") -> str:
        if not primary and not secondary and not background:
            return "Please specify at least one color to change."

        # Load current theme
        current_theme = load_theme()

        # Validate hex colors if provided
        invalid: List[str] = []
        if primary and primary.startswith('#') and not is_valid_hex_color(primary):
            invalid.append("Primary")
        if secondary and secondary.startswith('#') and not is_valid_hex_color(secondary):
            invalid.append("Secondary")
        if background and background.startswith('#') and not is_valid_hex_color(background):
            invalid.append("Background")

        if invalid:
            return f"Invalid hex colors for: {', '.join(invalid)}. Use format like #2563eb or color names."

        # Update theme
        updated_theme = current_theme.copy()
        if primary:
            updated_theme["primary"] = primary
        if secondary:
            updated_theme["secondary"] = secondary
        if background:
            updated_theme["background"] = background

        # Ensure all required keys are present
        for key, default_value in DEFAULT_THEME.items():
            if key not in updated_theme:
                updated_theme[key] = default_value

        # Save theme
        save_theme(updated_theme)

        return f"Theme applied and saved: Primary {primary or 'unchanged'}, Secondary {secondary or 'unchanged'}, Background {background or 'unchanged'}."

    def get_schema(self) -> Dict:
        schema = super().get_schema()
        schema["function"]["parameters"]["properties"] = {
            "primary": {
                "type": "string",
                "description": "Primary color (hex like #2563eb or color name)"
            },
            "secondary": {
                "type": "string",
                "description": "Secondary color (hex like #2563eb or color name)"
            },
            "background": {
                "type": "string",
                "description": "Background color (hex like #2563eb or color name)"
            }
        }
        schema["function"]["parameters"]["required"] = []
        return schema
