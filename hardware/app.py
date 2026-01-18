#!/usr/bin/env python3
"""
Futuristic TUI for Hardware App
Using Textual library for rich terminal UI.
"""

from typing import Dict

from textual.app import App

from src.config import DEFAULT_THEME
from src.screens.main_menu import MainMenu
from src.screens.settings import SettingsScreen
from src.screens.profile import ProfileScreen
from src.screens.smart_mode import SmartModeScreen


class HardwareApp(App):
    """Main app."""

    CSS_PATH = "styles.tcss"

    SCREENS = {
        "main": MainMenu,
        "settings": SettingsScreen,
        "profile": ProfileScreen,
        "smart_mode": SmartModeScreen,
    }

    def __init__(self) -> None:
        super().__init__()
        # Custom theme dict for reference
        self.custom_theme: Dict[str, str] = DEFAULT_THEME.copy()

    def on_mount(self) -> None:
        self.push_screen("main")

if __name__ == "__main__":
    app = HardwareApp()
    app.run()