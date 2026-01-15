import ollama
import logging
from typing import Any
from textual.containers import Vertical, ScrollableContainer
from textual.screen import Screen
from textual.widgets import Header, Footer, Static, Input, Button

class SmartModeScreen(Screen):
    """Smart Mode screen with AI chat interface using Llama 3 3B."""

    def compose(self) -> None:
        yield Header("Smart Mode - Chat with Llama 3 3B")
        with ScrollableContainer(classes="center-container"):
            with Vertical(classes="card"):
                yield Static("Enter your message below to chat with Llama 3 3B:", classes="menu-title")
                self.chat_log = Vertical(id="chat_log")
                yield self.chat_log
                with Vertical():
                    self.message_input = Input(placeholder="Type your message here...", id="message_input")
                    yield self.message_input
                    yield Button("Send", id="send_button")
                    yield Button("Back to Main", id="back_main")
        yield Footer()

    async def on_button_pressed(self, event: Any) -> None:
        if event.button.id == "send_button":
            await self.send_message()
        elif event.button.id == "back_main":
            await self.app.pop_screen()

    async def send_message(self) -> None:
        message = self.message_input.value.strip()
        if not message:
            self.app.notify("Please enter a message.", severity="warning")
            return

        # Display user message
        self.chat_log.mount(Static(f"You: {message}", classes="user-message"))
        self.message_input.value = ""

        # Send to AI
        try:
            response = await ollama.chat(
                model='llama3.2:3b',  # Assuming this model is available
                messages=[{'role': 'user', 'content': message}]
            )
            ai_response = response['message']['content']
        except Exception as e:
            logging.error(f"Error communicating with AI: {str(e)}")
            ai_response = "Mock response: Hello, I am a mock AI. Please install Ollama and pull the llama3.2:3b model to use real AI chat. Error: " + str(e)
        self.chat_log.mount(Static(f"Llama: {ai_response}", classes="ai-message"))

    async def on_input_submitted(self, event: Any) -> None:
        if event.input.id == "message_input":
            await self.send_message()