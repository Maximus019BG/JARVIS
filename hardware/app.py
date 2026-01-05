#!/usr/bin/env python3
"""
Futuristic TUI for Hardware App
Using Textual library for rich terminal UI.
"""

from textual.app import App
from src.config import DEFAULT_THEME
from src.screens.main_menu import MainMenu
from src.screens.settings import SettingsScreen
from src.screens.profile import ProfileScreen

class HardwareApp(App):
    """Main app."""

    CSS_PATH = "styles.css"

    SCREENS = {
        "main": MainMenu,
        "settings": SettingsScreen,
        "profile": ProfileScreen,
    }

    def __init__(self):
        super().__init__()
        # Custom theme dict for reference
        self.custom_theme = DEFAULT_THEME.copy()

    def on_mount(self):
        self.push_screen("main")

if __name__ == "__main__":
    app = HardwareApp()
    app.run()