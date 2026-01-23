"""Summarize tool for condensing text content.

Provides text summarization using the LLM.
"""

from __future__ import annotations

from typing import Any

from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolError

logger = get_logger(__name__)


class SummarizeTool(BaseTool):
    """Tool for summarizing text content.

    Uses the LLM to create concise summaries of longer text.
    """

    def __init__(self) -> None:
        self._llm = None

    def _get_llm(self):
        """Lazy-load LLM."""
        if self._llm is None:
            from core.llm.provider_factory import LLMProviderFactory

            self._llm = LLMProviderFactory.create()
        return self._llm

    @property
    def name(self) -> str:
        return "summarize"

    @property
    def description(self) -> str:
        return (
            "Summarize text content into a shorter, more concise form. "
            "Useful for condensing long documents, articles, or conversations."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The text to summarize",
                },
                "length": {
                    "type": "string",
                    "description": "Summary length: 'brief' (1-2 sentences), 'short' (1 paragraph), 'medium' (2-3 paragraphs), 'detailed' (comprehensive)",
                    "enum": ["brief", "short", "medium", "detailed"],
                    "default": "short",
                },
                "focus": {
                    "type": "string",
                    "description": "Specific aspect to focus on (optional)",
                },
                "format": {
                    "type": "string",
                    "description": "Output format: 'prose', 'bullets', 'numbered'",
                    "enum": ["prose", "bullets", "numbered"],
                    "default": "prose",
                },
            },
            "required": ["text"],
        }

    def execute(
        self,
        text: str = "",
        length: str = "short",
        focus: str = "",
        format: str = "prose",
    ) -> str:
        """Execute summarization.

        Args:
            text: Text to summarize.
            length: Summary length.
            focus: Optional focus area.
            format: Output format.

        Returns:
            Summary of the text.
        """
        if not text.strip():
            return "Please provide text to summarize."

        # For very short text, no need to summarize
        if len(text) < 200:
            return f"Text is already brief:\n{text}"

        length_instructions = {
            "brief": "Summarize in 1-2 sentences only.",
            "short": "Summarize in one paragraph (3-5 sentences).",
            "medium": "Summarize in 2-3 paragraphs with main points.",
            "detailed": "Provide a comprehensive summary covering all key points.",
        }

        format_instructions = {
            "prose": "Write in flowing prose.",
            "bullets": "Use bullet points for key points.",
            "numbered": "Use numbered list for key points.",
        }

        prompt = f"""Summarize the following text:

---
{text}
---

Instructions:
- {length_instructions.get(length, length_instructions["short"])}
- {format_instructions.get(format, format_instructions["prose"])}
"""

        if focus:
            prompt += f"- Focus particularly on: {focus}\n"

        try:
            import asyncio

            llm = self._get_llm()

            # Run async method synchronously
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                response = loop.run_until_complete(
                    llm.chat_with_tools(
                        message=prompt,
                        tools=[],
                        conversation_history=[],
                    )
                )
            finally:
                loop.close()

            summary = response.get("message", {}).get("content", "")
            if not summary:
                return "Failed to generate summary."

            logger.info(f"Summarized {len(text)} chars to {len(summary)} chars")
            return summary

        except Exception as e:
            logger.error(f"Summarization failed: {e}")
            raise ToolError(f"Summarization failed: {e}") from e


class ExtractKeyPointsTool(BaseTool):
    """Tool for extracting key points from text."""

    def __init__(self) -> None:
        self._llm = None

    def _get_llm(self):
        """Lazy-load LLM."""
        if self._llm is None:
            from core.llm.provider_factory import LLMProviderFactory

            self._llm = LLMProviderFactory.create()
        return self._llm

    @property
    def name(self) -> str:
        return "extract_key_points"

    @property
    def description(self) -> str:
        return (
            "Extract key points, facts, and important information from text. "
            "Returns a structured list of the most important points."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The text to extract key points from",
                },
                "max_points": {
                    "type": "integer",
                    "description": "Maximum number of key points to extract",
                    "default": 10,
                },
                "category": {
                    "type": "string",
                    "description": "Category to focus on (e.g., 'facts', 'actions', 'decisions')",
                },
            },
            "required": ["text"],
        }

    def execute(
        self,
        text: str = "",
        max_points: int = 10,
        category: str = "",
    ) -> str:
        """Extract key points from text.

        Args:
            text: Text to analyze.
            max_points: Maximum points to extract.
            category: Optional category focus.

        Returns:
            List of key points.
        """
        if not text.strip():
            return "Please provide text to analyze."

        prompt = f"""Extract the {max_points} most important key points from this text:

---
{text}
---

Format as a numbered list. Each point should be:
- Concise (1-2 sentences max)
- Self-contained (understandable without context)
- Factual and objective
"""

        if category:
            prompt += f"\nFocus specifically on: {category}"

        try:
            import asyncio

            llm = self._get_llm()

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                response = loop.run_until_complete(
                    llm.chat_with_tools(
                        message=prompt,
                        tools=[],
                        conversation_history=[],
                    )
                )
            finally:
                loop.close()

            result = response.get("message", {}).get("content", "")
            if not result:
                return "Failed to extract key points."

            logger.info(f"Extracted key points from {len(text)} chars")
            return result

        except Exception as e:
            logger.error(f"Key point extraction failed: {e}")
            raise ToolError(f"Key point extraction failed: {e}") from e
