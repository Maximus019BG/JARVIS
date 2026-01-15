from textual.containers import Vertical, Grid, Container, ScrollableContainer
from textual.screen import Screen
from textual.widgets import Header, Footer, Static, Button

class MainMenu(Screen):
    """Main menu screen with professional card-based layout."""

    def compose(self):
        yield Header("JARVIS Hardware Control")
        with ScrollableContainer(classes="center-container"):
            with Vertical(classes="card"):
                yield Static("Select an option:", classes="menu-title")
                with Grid(id="menu_grid"):
                    yield Button("Load Blueprint", id="load_blueprint")
                    yield Button("Create Blueprint", id="create_blueprint")
                    yield Button("Live Assistance", id="live_assistance")
                    yield Button("Settings", id="settings")
                    yield Button("Smart Mode", id="smart_mode")
                    yield Button("Quit", id="quit")
        yield Footer()

    async def load_blueprint(self):
        # Placeholder
        self.app.notify("Loading Blueprint...")

    async def create_blueprint(self):
        self.app.notify("Creating Blueprint...")

    async def live_assistance(self):
        self.app.notify("Live Assistance Activated")

    async def open_settings(self):
        await self.app.push_screen("settings")

    async def smart_mode(self):
        await self.app.push_screen("smart_mode")

    async def quit_app(self):
        self.app.exit()

    async def on_button_pressed(self, event):
        if event.button.id == "load_blueprint":
            await self.load_blueprint()
        elif event.button.id == "create_blueprint":
            await self.create_blueprint()
        elif event.button.id == "live_assistance":
            await self.live_assistance()
        elif event.button.id == "settings":
            await self.open_settings()
        elif event.button.id == "smart_mode":
            await self.smart_mode()
        elif event.button.id == "quit":
            await self.quit_app()