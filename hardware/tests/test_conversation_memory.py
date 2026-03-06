"""Tests for ConversationMemory — clear_history, get_recent_messages."""

from __future__ import annotations

from unittest.mock import patch, MagicMock

from core.memory.conversation_memory import ConversationMemory


class TestConversationMemory:
    def test_init_with_max(self) -> None:
        mem = ConversationMemory(max_messages=5)
        assert mem.history.maxlen == 5

    def test_add_and_get_history(self) -> None:
        mem = ConversationMemory(max_messages=10)
        mem.add_message("user", "hello")
        mem.add_message("assistant", "hi")
        h = mem.get_history()
        assert len(h) == 2
        assert h[0]["role"] == "user"

    def test_add_with_kwargs(self) -> None:
        mem = ConversationMemory(max_messages=10)
        mem.add_message("assistant", "reply", tool_calls=[{"id": "1"}])
        assert mem.get_history()[0]["tool_calls"] == [{"id": "1"}]

    def test_clear_history(self) -> None:
        mem = ConversationMemory(max_messages=10)
        mem.add_message("user", "a")
        mem.add_message("user", "b")
        mem.clear_history()
        assert mem.get_history() == []

    def test_maxlen_eviction(self) -> None:
        mem = ConversationMemory(max_messages=3)
        for i in range(5):
            mem.add_message("user", str(i))
        h = mem.get_history()
        assert len(h) == 3
        assert h[0]["content"] == "2"

    def test_get_recent_messages_with_n(self) -> None:
        mem = ConversationMemory(max_messages=10)
        for i in range(5):
            mem.add_message("user", str(i))
        recent = mem.get_recent_messages(n=2)
        assert len(recent) == 2
        assert recent[0]["content"] == "3"

    def test_get_recent_messages_n_larger_than_history(self) -> None:
        mem = ConversationMemory(max_messages=10)
        mem.add_message("user", "only one")
        recent = mem.get_recent_messages(n=100)
        assert len(recent) == 1

    @patch("config.config.get_config")
    def test_get_recent_messages_default_n(self, mock_cfg: MagicMock) -> None:
        cfg = MagicMock()
        cfg.conversation_recent_messages = 3
        mock_cfg.return_value = cfg
        mem = ConversationMemory(max_messages=10)
        for i in range(6):
            mem.add_message("user", str(i))
        recent = mem.get_recent_messages()  # n=None → from config
        assert len(recent) == 3

    @patch("config.config.get_config")
    def test_init_default_max(self, mock_cfg: MagicMock) -> None:
        cfg = MagicMock()
        cfg.conversation_max_messages = 7
        mock_cfg.return_value = cfg
        mem = ConversationMemory()
        assert mem.history.maxlen == 7
