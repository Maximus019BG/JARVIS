import re
from typing import List

from textual.containers import Vertical, Horizontal, ScrollableContainer
from textual.screen import Screen
from textual.widgets import Header, Footer, Static, Button, Input

from src.config import HARD_CODED_STATS


def is_valid_hex_color(color: str) -> bool:
    """Validate hex color format (e.g., #2563eb or #0f8)."""
    return bool(re.match(r'^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$', color))


class SettingsScreen(Screen):
    """Settings screen with professional card-based layout."""

    def compose(self):
        yield Header("Settings")
        with ScrollableContainer(classes="center-container"):
            with Vertical(classes="card"):
                # Theme section
                with Vertical(classes="card"):
                    yield Static("Theme Customization", classes="section-title")
                    yield Static("Enter hex colors (e.g., #2563eb) or color names.", classes="help-text")

                    # Color inputs with labels
                    yield Static("Primary Color:", classes="input-label")
                    self.primary_input = Input(value=self.app.custom_theme.get("primary", "#158c68"), placeholder="#158c68", id="primary_color")
                    yield self.primary_input

                    yield Static("Secondary Color:", classes="input-label")
                    self.secondary_input = Input(value=self.app.custom_theme.get("secondary", "#a7f3d0"), placeholder="#a7f3d0", id="secondary_color")
                    yield self.secondary_input

                    yield Static("Background Color:", classes="input-label")
                    self.bg_input = Input(value=self.app.custom_theme.get("background", "#171717"), placeholder="#171717", id="bg_color")
                    yield self.bg_input

                    yield Button("🎨 Apply Theme", id="apply_theme")

                # Stats and Profile sections - horizontal on large screens
                with Horizontal():
                    with Vertical(classes="card"):
                        yield Static("System Stats", classes="section-title")
                        for key, value in HARD_CODED_STATS.items():
                            yield Static(f"{key}: {value}")

                    with Vertical(classes="card"):
                        yield Static("Profile", classes="section-title")
                        yield Button("✏️ Edit Profile", id="edit_profile")
                        yield Button("🏠 Back to Main", id="back_main")
        yield Footer()

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "apply_theme":
            # Get values
            primary = self.primary_input.value or "#158c68"
            secondary = self.secondary_input.value or "#a7f3d0"
            bg = self.bg_input.value or "#171717"

            # Validate hex if provided, else accept as color name
            invalid: List[str] = []
            if primary.startswith('#') and not is_valid_hex_color(primary):
                invalid.append("Primary")
            if secondary.startswith('#') and not is_valid_hex_color(secondary):
                invalid.append("Secondary")
            if bg.startswith('#') and not is_valid_hex_color(bg):
                invalid.append("Background")

            if invalid:
                self.app.notify(f"Invalid hex colors for: {', '.join(invalid)}. Use format like #2563eb or color names.", severity="error")
                return

            # Update custom theme dict
            self.app.custom_theme = {
                "primary": primary,
                "secondary": secondary,
                "background": bg,
                "surface": "#242323",
                "text_primary": "#f0fdf4",
                "text_secondary": "#a7f3d0",
                "accent": "#10b981",
                "error": "#ef4444",
                "border": "#4b5563",
            }
            self.app.notify(f"Theme applied: Primary {primary}, Secondary {secondary}, BG {bg}")
            # Note: To fully apply, might need to reload CSS or restart
        elif event.button.id == "edit_profile":
            await self.app.push_screen("profile")
        elif event.button.id == "back_main":
            await self.app.pop_screen()