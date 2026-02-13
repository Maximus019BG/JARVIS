"""Tool to apply theme changes."""

from __future__ import annotations

# Standard library imports
import re

# Local application imports
from core.base_tool import BaseTool, ToolResult
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
    return bool(re.match(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$", color))


class ApplyThemeTool(BaseTool):
    """Tool for applying theme settings."""

    @property
    def name(self) -> str:
        return "apply_theme"

    @property
    def description(self) -> str:
        return "Applies a new theme with specified colors."

    def execute(
        self, primary: str = "", secondary: str = "", background: str = ""
    ) -> ToolResult:
        if not primary and not secondary and not background:
            return ToolResult.fail(
                "Please specify at least one color to change.",
                error_type="ValidationError",
            )

        # Load current theme
        current_theme = load_theme()

        # Validate hex colors if provided
        invalid: list[str] = []
        if primary and primary.startswith("#") and not is_valid_hex_color(primary):
            invalid.append("Primary")
        if (
            secondary
            and secondary.startswith("#")
            and not is_valid_hex_color(secondary)
        ):
            invalid.append("Secondary")
        if (
            background
            and background.startswith("#")
            and not is_valid_hex_color(background)
        ):
            invalid.append("Background")

        if invalid:
            return ToolResult.fail(
                f"Invalid hex colors for: {', '.join(invalid)}. Use format like #2563eb or color names.",
                error_type="ValidationError",
            )

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

        return ToolResult.ok_result(
            f"Theme applied and saved: Primary {primary or 'unchanged'}, Secondary {secondary or 'unchanged'}, Background {background or 'unchanged'}."
        )

    def schema_parameters(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {
                "primary": {
                    "type": "string",
                    "description": "Primary color (hex like #2563eb or color name)",
                },
                "secondary": {
                    "type": "string",
                    "description": "Secondary color (hex like #2563eb or color name)",
                },
                "background": {
                    "type": "string",
                    "description": "Background color (hex like #2563eb or color name)",
                },
            },
            "required": [],
            "additionalProperties": False,
        }
