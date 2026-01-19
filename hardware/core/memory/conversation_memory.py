"""Conversation memory management for chat history."""

import time
from collections import deque
from typing import Any, Dict, List


class ConversationMemory:
    """Manages conversation history with limited memory."""

    def __init__(self, max_messages: int = 50):
        self.history: deque = deque(maxlen=max_messages)
        self._cache = {}  # Simple cache for frequent operations

    def add_message(self, role: str, content: str, **kwargs) -> None:
        """Add a message to the conversation history."""
        message = {"role": role, "content": content}
        message.update(kwargs)
        self.history.append(message)

    def get_history(self) -> List[Dict[str, str]]:
        """Get the full conversation history."""
        return list(self.history)

    def clear_history(self) -> None:
        """Clear the conversation history."""
        self.history.clear()

    def get_recent_messages(self, n: int = 10) -> List[Dict[str, str]]:
        """Get the most recent n messages."""
        return list(self.history)[-n:] if len(self.history) > n else list(self.history)
