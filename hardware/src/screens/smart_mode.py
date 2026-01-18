import logging
import asyncio
import hashlib
import json
import aiohttp
from typing import Any, Dict
from jinja2 import Template

logging.basicConfig(filename='debug.log', level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

from textual.containers import Vertical, ScrollableContainer
from textual.screen import Screen
from textual.widgets import Header, Footer, Static, Input, Button

class SmartModeScreen(Screen):
    """Smart Mode screen with AI chat interface using Llama 3 3B."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.cache: Dict[str, str] = {}
        self.typing_indicator = None
        self.ai_message = None
        self.user_template = Template("You: {{ message }}")
        self.ai_template = Template("Llama: {{ response }}")

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
                    self.send_button = Button("📤 Send", id="send_button")
                    yield self.send_button
                    yield Button("🏠 Back to Main", id="back_main")
        yield Footer()

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "send_button":
            await self.send_message()
        elif event.button.id == "back_main":
            await self.app.pop_screen()

    async def send_message(self) -> None:
        message = self.message_input.value.strip()
        if not message:
            self.app.notify("Please enter a message.", severity="warning")
            return

        # Disable send button to prevent multiple sends
        self.send_button.disabled = True

        # Display user message
        self.chat_log.mount(Static(self.user_template.render(message=message), classes="user-message"))
        self.message_input.value = ""

        # Add typing indicator
        self.typing_indicator = Static("Llama is thinking...", classes="typing-indicator")
        self.chat_log.mount(self.typing_indicator)

        # Check cache
        message_hash = hashlib.md5(message.encode()).hexdigest()
        if message_hash in self.cache:
            ai_response = self.cache[message_hash]
            self.chat_log.mount(Static(self.ai_template.render(response=ai_response), classes="ai-message"))
            self.typing_indicator.remove()
            self.send_button.disabled = False
            return

        # Create AI response widget
        self.ai_message = Static(self.ai_template.render(response=""), classes="ai-message")
        self.chat_log.mount(self.ai_message)

        ai_response = ""

        # Send to AI with async streaming and timeout
        try:
            async def call_ollama():
                nonlocal ai_response
                logging.info("Starting async Ollama chat call for message: %s", message[:50])
                payload = {
                    "model": "llama3.2:3b",
                    "messages": [{"role": "user", "content": message}],
                    "stream": True
                }
                async with aiohttp.ClientSession() as session:
                    async with session.post("http://127.0.0.1:11434/api/chat", json=payload) as response:
                        if response.status != 200:
                            raise Exception(f"Ollama API error: {response.status}")
                        async for line in response.content:
                            line = line.decode('utf-8').strip()
                            if line.startswith('data: '):
                                try:
                                    chunk = json.loads(line[6:])
                                    logging.debug(f"Parsed SSE chunk: {chunk}")
                                except json.JSONDecodeError:
                                    logging.warning(f"Failed to parse SSE line: {line}")
                                    continue
                            else:
                                try:
                                    chunk = json.loads(line)
                                    logging.debug(f"Parsed NDJSON chunk: {chunk}")
                                except json.JSONDecodeError:
                                    logging.debug(f"Ignored non-JSON line: {line}")
                                    continue
                            if 'message' in chunk and 'content' in chunk['message']:
                                content = chunk['message']['content']
                                ai_response += content
                                logging.debug(f"Accumulated content: '{content}', ai_response len: {len(ai_response)}")
                            elif chunk.get('done', False):
                                break
                logging.info(f"Ollama response completed, length: {len(ai_response)}")

            await asyncio.wait_for(call_ollama(), timeout=60.0)  # 60 second timeout

            # Start typing effect
            await self.type_response(ai_response)

            # Cache the response
            self.cache[message_hash] = ai_response

        except asyncio.TimeoutError:
            logging.error("AI response timed out")
            ai_response = "Sorry, the AI response timed out. Please try again."
            self.ai_message.update(self.ai_template.render(response=ai_response))
        except Exception as e:
            logging.error(f"Error communicating with AI: {str(e)}")
            ai_response = f"Sorry, there was an error: {str(e)}. Please ensure Ollama is running and the model is installed."
            self.ai_message.update(self.ai_template.render(response=ai_response))

        # Remove typing indicator
        if self.typing_indicator in self.chat_log.children:
            self.typing_indicator.remove()

        # Re-enable send button
        self.send_button.disabled = False

    async def type_response(self, full_response: str) -> None:
        for i in range(len(full_response)):
            partial = self.ai_template.render(response=full_response[:i+1])
            self.ai_message.update(partial)
            await asyncio.sleep(0.05)

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id == "message_input":
            await self.send_message()