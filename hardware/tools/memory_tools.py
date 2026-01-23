"""Memory tools for storing and retrieving information.

Provides memory management capabilities using the MemoryAgent.
"""

from __future__ import annotations

from typing import Any

from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolError

logger = get_logger(__name__)


class RememberTool(BaseTool):
    """Tool for storing information in memory."""

    def __init__(self) -> None:
        self._memory_agent = None

    def _get_memory_agent(self):
        """Lazy-load memory agent."""
        if self._memory_agent is None:
            from core.agents.memory_agent import MemoryAgent

            self._memory_agent = MemoryAgent()
        return self._memory_agent

    @property
    def name(self) -> str:
        return "remember"

    @property
    def description(self) -> str:
        return (
            "Store information in memory for later retrieval. "
            "Use this to save important facts, preferences, or context."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The information to remember",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Tags to categorize this memory",
                },
                "priority": {
                    "type": "string",
                    "description": "Importance: 'critical', 'high', 'medium', 'low'",
                    "enum": ["critical", "high", "medium", "low"],
                    "default": "medium",
                },
                "memory_type": {
                    "type": "string",
                    "description": "Type of memory: 'fact', 'preference', 'task', 'context', 'knowledge'",
                    "enum": ["fact", "preference", "task", "context", "knowledge"],
                    "default": "fact",
                },
            },
            "required": ["content"],
        }

    def execute(
        self,
        content: str = "",
        tags: list[str] | None = None,
        priority: str = "medium",
        memory_type: str = "fact",
    ) -> str:
        """Store information in memory.

        Args:
            content: Information to remember.
            tags: Categorization tags.
            priority: Memory priority.
            memory_type: Type of memory.

        Returns:
            Confirmation message.
        """
        if not content.strip():
            return "Please provide content to remember."

        try:
            from core.agents.memory_agent import MemoryPriority, MemoryType

            agent = self._get_memory_agent()

            # Map string to enums
            priority_map = {
                "critical": MemoryPriority.CRITICAL,
                "high": MemoryPriority.HIGH,
                "medium": MemoryPriority.MEDIUM,
                "low": MemoryPriority.LOW,
            }

            type_map = {
                "fact": MemoryType.FACT,
                "preference": MemoryType.PREFERENCE,
                "task": MemoryType.TASK,
                "context": MemoryType.CONTEXT,
                "knowledge": MemoryType.KNOWLEDGE,
            }

            memory = agent.store(
                content=content,
                memory_type=type_map.get(memory_type, MemoryType.FACT),
                priority=priority_map.get(priority, MemoryPriority.MEDIUM),
                tags=tags or [],
            )

            logger.info(f"Stored memory: {memory.id}")
            return f"Remembered: '{content[:50]}...' (ID: {memory.id}, Tags: {tags or []})"

        except Exception as e:
            logger.error(f"Failed to store memory: {e}")
            raise ToolError(f"Failed to remember: {e}") from e


class RecallTool(BaseTool):
    """Tool for retrieving information from memory."""

    def __init__(self) -> None:
        self._memory_agent = None

    def _get_memory_agent(self):
        """Lazy-load memory agent."""
        if self._memory_agent is None:
            from core.agents.memory_agent import MemoryAgent

            self._memory_agent = MemoryAgent()
        return self._memory_agent

    @property
    def name(self) -> str:
        return "recall"

    @property
    def description(self) -> str:
        return (
            "Retrieve information from memory. "
            "Search by query, tags, or memory type."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query for memories",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by tags",
                },
                "memory_type": {
                    "type": "string",
                    "description": "Filter by type: 'fact', 'preference', 'task', 'context', 'knowledge'",
                    "enum": ["fact", "preference", "task", "context", "knowledge"],
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results",
                    "default": 5,
                },
            },
            "required": ["query"],
        }

    def execute(
        self,
        query: str = "",
        tags: list[str] | None = None,
        memory_type: str | None = None,
        limit: int = 5,
    ) -> str:
        """Retrieve memories.

        Args:
            query: Search query.
            tags: Filter by tags.
            memory_type: Filter by type.
            limit: Maximum results.

        Returns:
            Found memories.
        """
        if not query.strip():
            return "Please provide a search query."

        try:
            from core.agents.memory_agent import MemoryType

            agent = self._get_memory_agent()

            # Map string to enum
            type_map = {
                "fact": MemoryType.FACT,
                "preference": MemoryType.PREFERENCE,
                "task": MemoryType.TASK,
                "context": MemoryType.CONTEXT,
                "knowledge": MemoryType.KNOWLEDGE,
            }

            mem_type = type_map.get(memory_type) if memory_type else None

            memories = agent.recall(
                query=query,
                memory_type=mem_type,
                tags=tags,
                limit=limit,
            )

            if not memories:
                return f"No memories found matching: {query}"

            result = [f"## Found {len(memories)} memories:\n"]
            for mem in memories:
                result.append(f"**[{mem.id}]** ({mem.memory_type.value})")
                result.append(f"  {mem.content}")
                if mem.tags:
                    result.append(f"  Tags: {', '.join(mem.tags)}")
                result.append("")

            logger.info(f"Recalled {len(memories)} memories for: {query}")
            return "\n".join(result)

        except Exception as e:
            logger.error(f"Failed to recall memories: {e}")
            raise ToolError(f"Failed to recall: {e}") from e


class ForgetTool(BaseTool):
    """Tool for removing information from memory."""

    def __init__(self) -> None:
        self._memory_agent = None

    def _get_memory_agent(self):
        """Lazy-load memory agent."""
        if self._memory_agent is None:
            from core.agents.memory_agent import MemoryAgent

            self._memory_agent = MemoryAgent()
        return self._memory_agent

    @property
    def name(self) -> str:
        return "forget"

    @property
    def description(self) -> str:
        return "Remove a specific memory by its ID."

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "memory_id": {
                    "type": "string",
                    "description": "The ID of the memory to forget (e.g., 'mem_000001')",
                },
            },
            "required": ["memory_id"],
        }

    def execute(self, memory_id: str = "") -> str:
        """Forget a memory.

        Args:
            memory_id: ID of memory to remove.

        Returns:
            Confirmation message.
        """
        if not memory_id.strip():
            return "Please provide a memory ID."

        try:
            agent = self._get_memory_agent()
            success = agent.forget(memory_id)

            if success:
                logger.info(f"Forgot memory: {memory_id}")
                return f"Forgot memory: {memory_id}"
            else:
                return f"Memory not found: {memory_id}"

        except Exception as e:
            logger.error(f"Failed to forget memory: {e}")
            raise ToolError(f"Failed to forget: {e}") from e


class MemoryStatsTool(BaseTool):
    """Tool for viewing memory statistics."""

    def __init__(self) -> None:
        self._memory_agent = None

    def _get_memory_agent(self):
        """Lazy-load memory agent."""
        if self._memory_agent is None:
            from core.agents.memory_agent import MemoryAgent

            self._memory_agent = MemoryAgent()
        return self._memory_agent

    @property
    def name(self) -> str:
        return "memory_stats"

    @property
    def description(self) -> str:
        return "Get statistics about stored memories."

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {},
            "required": [],
        }

    def execute(self) -> str:
        """Get memory statistics.

        Returns:
            Memory statistics.
        """
        try:
            agent = self._get_memory_agent()
            stats = agent.get_stats()

            result = [
                "## Memory Statistics\n",
                f"**Short-term memories:** {stats['short_term_count']}",
                f"**Long-term memories:** {stats['long_term_count']}",
                f"**Total tags:** {stats['total_tags']}",
                "",
                "**By Type:**",
            ]

            for mem_type, count in stats["by_type"].items():
                if count > 0:
                    result.append(f"  - {mem_type}: {count}")

            result.append("")
            result.append("**By Priority:**")

            for priority, count in stats["by_priority"].items():
                if count > 0:
                    result.append(f"  - {priority}: {count}")

            return "\n".join(result)

        except Exception as e:
            logger.error(f"Failed to get memory stats: {e}")
            raise ToolError(f"Failed to get stats: {e}") from e
