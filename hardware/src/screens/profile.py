from textual.containers import Vertical, ScrollableContainer
from textual.screen import Screen
from textual.widgets import Header, Footer, Static, Button, Input

class ProfileScreen(Screen):
    """Profile edit screen with professional card layout."""

    def compose(self):
        yield Header("Edit Profile")
        with ScrollableContainer(classes="center-container"):
            with Vertical(classes="card"):
                yield Static("Profile Information", classes="section-title")

                yield Static("Name:", classes="input-label")
                self.name_input = Input(placeholder="Enter your name", id="name")
                yield self.name_input

                yield Static("Email:", classes="input-label")
                self.email_input = Input(placeholder="Enter your email", id="email")
                yield self.email_input

                yield Button("Save Profile", id="save_profile")
                yield Button("Back to Settings", id="back_settings")
        yield Footer()

    async def on_button_pressed(self, event):
        if event.button.id == "save_profile":
            name = self.name_input.value
            email = self.email_input.value
            # Placeholder: Save to file or db
            self.app.notify(f"Profile saved: {name}, {email}")
        elif event.button.id == "back_settings":
            await self.app.pop_screen()