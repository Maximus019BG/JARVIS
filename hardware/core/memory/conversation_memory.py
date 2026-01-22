"""Conversation memory management for chat history."""

from __future__ import annotations

from collections import deque
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from config.config import AppConfig


class ConversationMemory:
    """Manages conversation history with limited memory."""

    def __init__(self, max_messages: int | None = None, config: AppConfig | None = None):
        """Initialize conversation memory.

        Args:
            max_messages: Maximum number of messages to keep in history.
                          If None, uses value from config.
            config: Application configuration. If None, loads from environment.
        """
        if max_messages is None:
            from config.config import get_config

            config = config or get_config()
            max_messages = config.conversation_max_messages
        self.history: deque = deque(maxlen=max_messages)

    def add_message(self, role: str, content: str, **kwargs) -> None:
        """Add a message to the conversation history.

        Args:
            role: The role of the message sender (e.g., "user", "assistant").
            content: The content of the message.
            **kwargs: Additional message metadata such as:
                - tool_calls: List of tool calls made by the assistant.
        """
        message = {"role": role, "content": content}
        message.update(kwargs)
        self.history.append(message)

    def get_history(self) -> list[dict[str, str]]:
        """Get the full conversation history."""
        return list(self.history)

    def clear_history(self) -> None:
        """Clear the conversation history."""
        self.history.clear()

    def get_recent_messages(self, n: int | None = None) -> list[dict[str, str]]:
        """Get the most recent n messages.

        Args:
            n: Number of recent messages to retrieve. If None, uses value from config.

        Returns:
            List of the most recent messages.
        """
        if n is None:
            from config.config import get_config

            config = get_config()
            n = config.conversation_recent_messages
        return list(self.history)[-n:] if len(self.history) > n else list(self.history)
