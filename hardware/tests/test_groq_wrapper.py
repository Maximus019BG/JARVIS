"""Tests for core.llm.groq_wrapper – GroqWrapper, conversion helpers."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.llm.groq_wrapper import (
    _convert_tool_calls_to_ollama_format,
    _convert_tool_schema_to_openai,
)


# ---------------------------------------------------------------------------
# Schema conversion
# ---------------------------------------------------------------------------

class TestConvertToolSchema:
    def test_passthrough(self) -> None:
        tool = {"type": "function", "function": {"name": "foo", "parameters": {}}}
        result = _convert_tool_schema_to_openai(tool)
        assert result == tool

    def test_empty_dict(self) -> None:
        assert _convert_tool_schema_to_openai({}) == {}


# ---------------------------------------------------------------------------
# Tool call conversion
# ---------------------------------------------------------------------------

class TestConvertToolCalls:
    def test_converts_objects_to_dicts(self) -> None:
        tc = SimpleNamespace(
            id="call_1",
            function=SimpleNamespace(name="read_file", arguments='{"path": "/tmp"}'),
        )
        result = _convert_tool_calls_to_ollama_format([tc])
        assert len(result) == 1
        assert result[0]["id"] == "call_1"
        assert result[0]["type"] == "function"
        assert result[0]["function"]["name"] == "read_file"
        assert result[0]["function"]["arguments"] == '{"path": "/tmp"}'

    def test_empty_list(self) -> None:
        assert _convert_tool_calls_to_ollama_format([]) == []

    def test_multiple(self) -> None:
        tcs = [
            SimpleNamespace(
                id=f"call_{i}",
                function=SimpleNamespace(name=f"tool_{i}", arguments="{}"),
            )
            for i in range(3)
        ]
        result = _convert_tool_calls_to_ollama_format(tcs)
        assert len(result) == 3
        assert [r["id"] for r in result] == ["call_0", "call_1", "call_2"]


# ---------------------------------------------------------------------------
# GroqWrapper construction
# ---------------------------------------------------------------------------

class TestGroqWrapperInit:
    @patch("core.llm.groq_wrapper.GROQ_AVAILABLE", False)
    def test_import_error_when_not_available(self) -> None:
        from core.llm.groq_wrapper import GroqWrapper

        with pytest.raises(ImportError, match="not installed"):
            GroqWrapper(api_key="key")

    @patch("core.llm.groq_wrapper.GROQ_AVAILABLE", True)
    @patch("core.llm.groq_wrapper.AsyncGroq", create=True)
    def test_empty_api_key_raises(self, mock_groq: MagicMock) -> None:
        from core.llm.groq_wrapper import GroqWrapper

        with pytest.raises(ValueError, match="GROQ_API_KEY"):
            GroqWrapper(api_key="")

    @patch("core.llm.groq_wrapper.GROQ_AVAILABLE", True)
    @patch("core.llm.groq_wrapper.AsyncGroq", create=True)
    def test_successful_init(self, mock_groq: MagicMock) -> None:
        from core.llm.groq_wrapper import GroqWrapper

        wrapper = GroqWrapper(api_key="test-key", model_name="llama3", temperature=0.5)
        assert wrapper.model_name == "llama3"
        assert wrapper.temperature == 0.5
        assert wrapper.max_tokens == 4096


# ---------------------------------------------------------------------------
# _build_messages static method
# ---------------------------------------------------------------------------

class TestBuildMessages:
    @patch("core.llm.groq_wrapper.GROQ_AVAILABLE", True)
    @patch("core.llm.groq_wrapper.AsyncGroq", create=True)
    def test_no_history(self, _: MagicMock) -> None:
        from core.llm.groq_wrapper import GroqWrapper

        msgs = GroqWrapper._build_messages(None, "hello")
        assert msgs == [{"role": "user", "content": "hello"}]

    @patch("core.llm.groq_wrapper.GROQ_AVAILABLE", True)
    @patch("core.llm.groq_wrapper.AsyncGroq", create=True)
    def test_with_history(self, _: MagicMock) -> None:
        from core.llm.groq_wrapper import GroqWrapper

        history = [{"role": "system", "content": "You are helpful"}]
        msgs = GroqWrapper._build_messages(history, "hi")
        assert len(msgs) == 2
        assert msgs[0]["role"] == "system"
        assert msgs[1]["content"] == "hi"

    @patch("core.llm.groq_wrapper.GROQ_AVAILABLE", True)
    @patch("core.llm.groq_wrapper.AsyncGroq", create=True)
    def test_sanitises_tool_calls(self, _: MagicMock) -> None:
        from core.llm.groq_wrapper import GroqWrapper

        history = [
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "foo", "arguments": "{}"}}]},
        ]
        msgs = GroqWrapper._build_messages(history, "next")
        tc = msgs[0]["tool_calls"][0]
        assert tc["type"] == "function"
        assert "id" in tc
