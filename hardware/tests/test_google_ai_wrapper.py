"""Tests for Google AI wrapper."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestGoogleAIWrapper:
    """Tests for GoogleAIWrapper."""

    @pytest.fixture
    def mock_genai(self):
        """Mock the google.generativeai module."""
        with patch("core.llm.google_ai_wrapper.genai") as mock:
            with patch(
                "core.llm.google_ai_wrapper.GOOGLE_AI_AVAILABLE", True
            ):
                yield mock

    @pytest.fixture
    def wrapper(self, mock_genai):
        """Create a GoogleAIWrapper instance with mocked dependencies."""
        from core.llm.google_ai_wrapper import GoogleAIWrapper

        mock_genai.types.GenerationConfig.return_value = MagicMock()

        return GoogleAIWrapper(
            api_key="test_api_key",
            model_name="gemini-1.5-flash",
        )

    def test_init_configures_api_key(self, mock_genai):
        """Test that initialization configures the API key."""
        from core.llm.google_ai_wrapper import GoogleAIWrapper

        GoogleAIWrapper(api_key="test_key")
        mock_genai.configure.assert_called_once_with(api_key="test_key")

    def test_convert_to_gemini_tools_empty(self, wrapper):
        """Test tool conversion with empty list."""
        result = wrapper._convert_to_gemini_tools([])
        assert result is None

    def test_convert_to_gemini_tools(self, wrapper):
        """Test tool conversion with valid tools."""
        with patch(
            "core.llm.google_ai_wrapper.FunctionDeclaration"
        ) as mock_fd:
            with patch("core.llm.google_ai_wrapper.Tool") as mock_tool:
                tools = [
                    {
                        "function": {
                            "name": "test_tool",
                            "description": "A test tool",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "arg1": {"type": "string", "description": "First arg"}
                                },
                                "required": ["arg1"],
                            },
                        }
                    }
                ]

                wrapper._convert_to_gemini_tools(tools)

                mock_fd.assert_called_once()
                mock_tool.assert_called_once()

    def test_convert_parameters_empty(self, wrapper):
        """Test parameter conversion with empty dict."""
        result = wrapper._convert_parameters({})
        assert result is None

    def test_convert_parameters(self, wrapper):
        """Test parameter conversion with valid parameters."""
        params = {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "User name"},
                "age": {"type": "integer"},
            },
            "required": ["name"],
        }

        result = wrapper._convert_parameters(params)

        assert result["type"] == "OBJECT"
        assert "name" in result["properties"]
        assert result["properties"]["name"]["type"] == "STRING"
        assert result["required"] == ["name"]

    def test_convert_history_to_gemini(self, wrapper):
        """Test history conversion."""
        history = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
            {"role": "user", "content": "How are you?"},
        ]

        result = wrapper._convert_history_to_gemini(history)

        assert len(result) == 3
        assert result[0]["role"] == "user"
        assert result[1]["role"] == "model"  # assistant -> model

    def test_parse_response_text_only(self, wrapper):
        """Test parsing a text-only response."""
        mock_response = MagicMock()
        mock_response.candidates = [MagicMock()]
        mock_part = MagicMock()
        mock_part.function_call = None
        mock_part.text = "Hello, world!"
        mock_response.candidates[0].content.parts = [mock_part]

        result = wrapper._parse_response(mock_response)

        assert result["message"]["content"] == "Hello, world!"
        assert "tool_calls" not in result["message"]

    def test_parse_response_with_function_call(self, wrapper):
        """Test parsing a response with function call."""
        mock_response = MagicMock()
        mock_response.candidates = [MagicMock()]

        mock_fc = MagicMock()
        mock_fc.name = "test_function"
        mock_fc.args = {"arg1": "value1"}

        mock_part = MagicMock()
        mock_part.function_call = mock_fc
        mock_part.text = None

        mock_response.candidates[0].content.parts = [mock_part]

        result = wrapper._parse_response(mock_response)

        assert "tool_calls" in result["message"]
        assert len(result["message"]["tool_calls"]) == 1
        assert result["message"]["tool_calls"][0]["function"]["name"] == "test_function"


class TestGoogleAIWrapperIntegration:
    """Integration tests for GoogleAIWrapper (require API key)."""

    @pytest.fixture
    def api_key(self):
        """Get API key from environment."""
        import os

        key = os.getenv("GOOGLE_AI_API_KEY")
        if not key:
            pytest.skip("GOOGLE_AI_API_KEY not set")
        return key

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_chat_basic(self, api_key):
        """Test basic chat functionality."""
        from core.llm.google_ai_wrapper import GoogleAIWrapper

        wrapper = GoogleAIWrapper(api_key=api_key)
        response = await wrapper.chat_with_tools_async(
            "Say hello in one word",
            tools=[],
            conversation_history=[],
        )

        assert "message" in response
        assert response["message"]["content"]
