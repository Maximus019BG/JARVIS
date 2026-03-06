"""Tests for core.llm.gemma_wrapper – GemmaWrapper."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# GemmaWrapper construction
# ---------------------------------------------------------------------------


class TestGemmaWrapperInit:
    @patch("core.llm.gemma_wrapper.OLLAMA_AVAILABLE", False)
    def test_import_error_when_not_available(self) -> None:
        from core.llm.gemma_wrapper import GemmaWrapper

        with pytest.raises(ImportError, match="not installed"):
            GemmaWrapper()

    @patch("core.llm.gemma_wrapper.OLLAMA_AVAILABLE", True)
    @patch("core.llm.gemma_wrapper.ollama")
    def test_successful_init(self, mock_ollama: MagicMock) -> None:
        mock_ollama.AsyncClient.return_value = MagicMock()
        from core.llm.gemma_wrapper import GemmaWrapper

        wrapper = GemmaWrapper(model_name="gemma3:1b")
        assert wrapper.model_name == "gemma3:1b"
        assert wrapper._supports_tools is None

    @patch("core.llm.gemma_wrapper.OLLAMA_AVAILABLE", True)
    @patch("core.llm.gemma_wrapper.ollama")
    def test_custom_model_name(self, mock_ollama: MagicMock) -> None:
        mock_ollama.AsyncClient.return_value = MagicMock()
        from core.llm.gemma_wrapper import GemmaWrapper

        wrapper = GemmaWrapper(model_name="custom:large")
        assert wrapper.model_name == "custom:large"


# ---------------------------------------------------------------------------
# chat_with_tools
# ---------------------------------------------------------------------------


class TestChatWithTools:
    @patch("core.llm.gemma_wrapper.OLLAMA_AVAILABLE", True)
    @patch("core.llm.gemma_wrapper.ollama")
    def test_chat_with_tools_supported(self, mock_ollama: MagicMock) -> None:
        import asyncio
        from core.llm.gemma_wrapper import GemmaWrapper

        mock_client = AsyncMock()
        mock_client.chat.return_value = {"message": {"content": "result", "tool_calls": []}}
        mock_ollama.AsyncClient.return_value = mock_client

        wrapper = GemmaWrapper()
        tools = [{"type": "function", "function": {"name": "test"}}]
        result = asyncio.run(wrapper.chat_with_tools("hello", tools))
        assert result["message"]["content"] == "result"
        assert wrapper._supports_tools is True

    @patch("core.llm.gemma_wrapper.OLLAMA_AVAILABLE", True)
    @patch("core.llm.gemma_wrapper.ollama")
    def test_chat_without_tools(self, mock_ollama: MagicMock) -> None:
        import asyncio
        from core.llm.gemma_wrapper import GemmaWrapper

        mock_client = AsyncMock()
        mock_client.chat.return_value = {"message": {"content": "plain response"}}
        mock_ollama.AsyncClient.return_value = mock_client

        wrapper = GemmaWrapper()
        result = asyncio.run(wrapper.chat_with_tools("hello", []))
        assert result["message"]["content"] == "plain response"

    @patch("core.llm.gemma_wrapper.OLLAMA_AVAILABLE", True)
    @patch("core.llm.gemma_wrapper.ollama")
    def test_falls_back_when_tools_unsupported(self, mock_ollama: MagicMock) -> None:
        import asyncio
        from core.llm.gemma_wrapper import GemmaWrapper

        mock_client = AsyncMock()
        # First call raises, second call succeeds
        mock_client.chat.side_effect = [
            Exception("model does not support tools"),
            {"message": {"content": "fallback"}},
        ]
        mock_ollama.AsyncClient.return_value = mock_client

        wrapper = GemmaWrapper()
        result = asyncio.run(wrapper.chat_with_tools("hello", [{"type": "function"}]))
        assert result["message"]["content"] == "fallback"
        assert wrapper._supports_tools is False


# ---------------------------------------------------------------------------
# continue_conversation
# ---------------------------------------------------------------------------


class TestContinueConversation:
    @patch("core.llm.gemma_wrapper.OLLAMA_AVAILABLE", True)
    @patch("core.llm.gemma_wrapper.ollama")
    def test_continue_returns_content(self, mock_ollama: MagicMock) -> None:
        import asyncio
        from core.llm.gemma_wrapper import GemmaWrapper

        mock_client = AsyncMock()
        mock_client.chat.return_value = {"message": {"content": "continued"}}
        mock_ollama.AsyncClient.return_value = mock_client

        wrapper = GemmaWrapper()
        wrapper._supports_tools = True
        result = asyncio.run(
            wrapper.continue_conversation(
                tool_results=[],
                conversation_history=[{"role": "user", "content": "hi"}],
                tools=[{"type": "function"}],
            )
        )
        assert result == "continued"

    @patch("core.llm.gemma_wrapper.OLLAMA_AVAILABLE", True)
    @patch("core.llm.gemma_wrapper.ollama")
    def test_continue_no_tools(self, mock_ollama: MagicMock) -> None:
        import asyncio
        from core.llm.gemma_wrapper import GemmaWrapper

        mock_client = AsyncMock()
        mock_client.chat.return_value = {"message": {"content": "no tools"}}
        mock_ollama.AsyncClient.return_value = mock_client

        wrapper = GemmaWrapper()
        wrapper._supports_tools = False
        result = asyncio.run(
            wrapper.continue_conversation(
                tool_results=[],
                conversation_history=[],
                tools=[],
            )
        )
        assert result == "no tools"
