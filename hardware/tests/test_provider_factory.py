"""Tests for LLM provider factory."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from config.config import AIConfig, AIProvider
from core.llm.provider_factory import LLMProvider, LLMProviderFactory


class TestLLMProviderFactory:
    """Tests for LLMProviderFactory."""

    @pytest.mark.skip(reason="Ollama not installed on this device")
    def test_create_ollama_provider(self):
        """Test creating Ollama provider."""
        pass

    @pytest.mark.skip(reason="Ollama not installed on this device")
    def test_create_google_provider_without_key_falls_back(self):
        """Test that Google provider falls back to Ollama without API key."""
        pass

    def test_create_google_provider_with_key(self):
        """Test creating Google provider with API key."""
        from pydantic import SecretStr

        config = AIConfig(
            provider=AIProvider.GOOGLE,
            google_api_key=SecretStr("test_key"),
            _env_file=None,
        )

        with patch("hardware.core.llm.google_ai_wrapper.genai") as mock_genai:
            with patch("hardware.core.llm.google_ai_wrapper.GOOGLE_AI_AVAILABLE", True):
                mock_genai.types.GenerationConfig.return_value = MagicMock()
                provider = LLMProviderFactory.create(config)
                assert provider is not None

    def test_create_with_fallback_primary_success(self):
        """Test create_with_fallback when primary succeeds."""
        config = AIConfig(provider=AIProvider.OLLAMA)

        with patch.object(LLMProviderFactory, "create") as mock_create:
            mock_provider = MagicMock(spec=LLMProvider)
            mock_create.return_value = mock_provider

            result = LLMProviderFactory.create_with_fallback(config)

            assert result is mock_provider

    def test_create_with_fallback_primary_fails(self):
        """Test create_with_fallback when primary fails."""
        config = AIConfig(provider=AIProvider.GOOGLE, google_api_key=None)

        call_count = 0

        def mock_create(cfg):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ValueError("Google API key required")
            return MagicMock(spec=LLMProvider)

        with patch.object(LLMProviderFactory, "create", side_effect=mock_create):
            result = LLMProviderFactory.create_with_fallback(config)

            assert call_count == 2  # Tried twice
            assert isinstance(result, MagicMock)
