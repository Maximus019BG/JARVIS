"""Orchestrator routing and execution helpers.

This module extracts the orchestration decision + runner logic out of `ChatHandler`.
Behavior is intentionally kept compatible with the prior inlined implementation.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from app_logging.logger import get_logger

if TYPE_CHECKING:
    from core.agents import OrchestratorAgent
    from core.memory import UnifiedMemoryManager

logger = get_logger(__name__)


# Keywords that suggest complex tasks needing orchestration
ORCHESTRATION_KEYWORDS = [
    "create",
    "build",
    "implement",
    "develop",
    "design",
    "plan",
    "analyze",
    "research",
    "review",
    "improve",
    "refactor",
    "debug",
    "fix",
    "optimize",
    "write code",
    "make a",
    "help me",
    "can you",
    "i need",
    "i want",
    "blueprint",
    "architecture",
    "system",
    "project",
]


class OrchestrationRouter:
    """Determines when to route a message to the orchestrator."""

    def __init__(self, orchestrator: "OrchestratorAgent | None") -> None:
        self._orchestrator = orchestrator

    def should_use_orchestrator(self, message: str) -> bool:
        """Return True if the message should be handled by the orchestrator."""
        if not self._orchestrator:
            return False

        message_lower = message.lower()

        for keyword in ORCHESTRATION_KEYWORDS:
            if keyword in message_lower:
                return True

        if len(message) > 200:
            return True

        if message.count(".") >= 3 or message.count(",") >= 4:
            return True

        return False


class OrchestrationRunner:
    """Runs the orchestrator workflow and applies metadata/footer formatting."""

    def __init__(
        self,
        orchestrator: "OrchestratorAgent",
        memory_manager: "UnifiedMemoryManager | None",
        logger_override=None,
    ) -> None:
        self._orchestrator = orchestrator
        self._memory_manager = memory_manager
        self._logger = logger_override or logger

    async def run(self, message: str, fallback_coro) -> str:
        """Run orchestration; on failure, fall back to the provided coroutine.

        Args:
            message: User message.
            fallback_coro: Callable returning awaitable[str] to use on failure.

        Returns:
            Response string.
        """
        start_time = time.time()

        try:
            context: dict = {}
            if self._memory_manager:
                context["memory_context"] = self._memory_manager.get_context_for_prompt(500)

            response = await self._orchestrator.orchestrate(message, context)

            if self._memory_manager:
                from core.memory import EventType

                self._memory_manager.record_event(
                    description=f"Orchestrated task: {message[:50]}...",
                    event_type=EventType.TASK_COMPLETE,
                    success=response.success,
                    importance=0.7,
                )

            elapsed = time.time() - start_time
            self._logger.info("Orchestration completed in %.2fs", elapsed)

            meta = response.metadata
            if meta.get("subtasks_total"):
                footer = (
                    f"\n\n---\n📊 Completed {meta['subtasks_completed']}/{meta['subtasks_total']} subtasks"
                )
                if meta.get("subtasks_failed"):
                    footer += f" ({meta['subtasks_failed']} failed)"
                return response.content + footer

            return response.content

        except Exception as exc:
            self._logger.error("Orchestration failed: %s", exc)
            return await fallback_coro()
