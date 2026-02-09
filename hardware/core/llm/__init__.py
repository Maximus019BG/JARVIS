"""LLM (Large Language Model) provider module.

Supports Ollama (Gemma and other local models).

Use LLMProviderFactory for dynamic provider creation based on configuration.
"""

from .gemma_wrapper import GemmaWrapper
from .provider_factory import LLMProvider, LLMProviderFactory

__all__ = [
    "GemmaWrapper",
    "LLMProvider",
    "LLMProviderFactory",
]
