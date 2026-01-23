"""Unified Memory Manager - Coordinates all memory systems.

Provides a single interface to:
- Semantic memory (facts and knowledge)
- Episodic memory (events and experiences)
- Working memory (current context)
- Conversation memory (chat history)

Features:
- Automatic memory consolidation
- Cross-memory search
- Context-aware retrieval
- Memory reflection and insights
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from app_logging.logger import get_logger
from core.memory.conversation_memory import ConversationMemory
from core.memory.episodic_memory import EpisodicMemory, Episode, EventType, Session
from core.memory.memory_store import (
    AdvancedMemoryStore,
    MemoryEntry,
    MemoryType,
    MemoryPriority,
)

logger = get_logger(__name__)


@dataclass
class MemorySearchResult:
    """Result from a cross-memory search."""

    source: str  # "semantic", "episodic", "conversation"
    content: str
    relevance: float
    timestamp: datetime
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ContextSnapshot:
    """A snapshot of the current memory context."""

    timestamp: datetime
    working_memories: list[MemoryEntry]
    recent_episodes: list[Episode]
    conversation_context: list[dict[str, str]]
    active_session: Session | None
    summary: str


class UnifiedMemoryManager:
    """Unified manager for all memory systems.

    Coordinates semantic, episodic, and working memory to provide
    intelligent context management and retrieval.
    """

    def __init__(
        self,
        storage_path: str = "data/memory",
        max_conversation_messages: int = 100,
        max_semantic_memories: int = 10000,
        max_episodes: int = 5000,
        working_memory_size: int = 20,
    ):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)

        # Initialize memory systems
        self.semantic = AdvancedMemoryStore(
            storage_path=str(self.storage_path / "semantic"),
            max_memories=max_semantic_memories,
            working_memory_size=working_memory_size,
        )

        self.episodic = EpisodicMemory(
            storage_path=str(self.storage_path / "episodic"),
            max_episodes=max_episodes,
        )

        self.conversation = ConversationMemory(
            max_messages=max_conversation_messages,
        )

        # Cross-memory links
        self._memory_links: dict[str, list[str]] = {}  # episode_id -> memory_ids

        # Reflection cache
        self._last_reflection: datetime | None = None
        self._reflection_interval = timedelta(hours=1)

    # ==================== Unified Operations ====================

    def remember(
        self,
        content: str,
        memory_type: MemoryType = MemoryType.SEMANTIC,
        priority: MemoryPriority = MemoryPriority.MEDIUM,
        tags: list[str] | None = None,
        context: str = "",
        source: str = "",
        record_episode: bool = True,
    ) -> MemoryEntry:
        """Store a memory and optionally record an episode.

        Args:
            content: What to remember.
            memory_type: Type of memory.
            priority: Importance level.
            tags: Tags for categorization.
            context: Surrounding context.
            source: Where this came from.
            record_episode: Whether to also record an episode.

        Returns:
            The created MemoryEntry.
        """
        # Store in semantic memory
        memory = self.semantic.store(
            content=content,
            memory_type=memory_type,
            priority=priority,
            tags=tags,
            source=source,
            context=context,
        )

        # Record episode if requested
        if record_episode:
            episode = self.episodic.record(
                description=f"Remembered: {content[:100]}",
                event_type=EventType.DISCOVERY,
                context={"memory_id": memory.id, "memory_type": memory_type.value},
                importance=0.4 if priority == MemoryPriority.LOW else 0.6,
                tags=tags or [],
            )

            # Link memory to episode
            self._link_memory_to_episode(memory.id, episode.id)

        logger.info(f"Remembered: {content[:50]}...")
        return memory

    def recall(
        self,
        query: str,
        include_semantic: bool = True,
        include_episodic: bool = True,
        include_conversation: bool = True,
        limit: int = 10,
    ) -> list[MemorySearchResult]:
        """Search across all memory systems.

        Args:
            query: Search query.
            include_semantic: Search semantic memory.
            include_episodic: Search episodic memory.
            include_conversation: Search conversation history.
            limit: Maximum results per source.

        Returns:
            List of MemorySearchResult from all sources.
        """
        results: list[MemorySearchResult] = []

        # Search semantic memory
        if include_semantic:
            semantic_results = self.semantic.recall(query, limit=limit)
            for memory, score in semantic_results:
                results.append(MemorySearchResult(
                    source="semantic",
                    content=memory.content,
                    relevance=score,
                    timestamp=memory.created_at,
                    metadata={
                        "id": memory.id,
                        "type": memory.memory_type.value,
                        "tags": memory.tags,
                    },
                ))

        # Search episodic memory
        if include_episodic:
            episodes = self.episodic.search(query, limit=limit)
            for episode in episodes:
                results.append(MemorySearchResult(
                    source="episodic",
                    content=episode.description,
                    relevance=episode.importance,
                    timestamp=episode.timestamp,
                    metadata={
                        "id": episode.id,
                        "type": episode.event_type.value,
                        "outcome": episode.outcome,
                    },
                ))

        # Search conversation history
        if include_conversation:
            query_lower = query.lower()
            for msg in self.conversation.get_history():
                if query_lower in msg.get("content", "").lower():
                    results.append(MemorySearchResult(
                        source="conversation",
                        content=msg.get("content", ""),
                        relevance=0.5,
                        timestamp=datetime.now(),  # Conversations don't have timestamps
                        metadata={"role": msg.get("role", "")},
                    ))

        # Sort by relevance
        results.sort(key=lambda r: r.relevance, reverse=True)

        return results[:limit * 2]  # Return more since we searched multiple sources

    def get_context(self, max_items: int = 10) -> ContextSnapshot:
        """Get a snapshot of the current memory context.

        Args:
            max_items: Maximum items per category.

        Returns:
            ContextSnapshot with current context.
        """
        working_memories = self.semantic.get_working_memory()[:max_items]
        recent_episodes = self.episodic.recall_recent(max_items)
        conversation = self.conversation.get_recent_messages(max_items)
        active_session = self.episodic.get_current_session()

        # Generate summary
        summary_parts = []

        if active_session:
            summary_parts.append(f"Active session: {active_session.name}")
            if active_session.goals:
                summary_parts.append(f"Goals: {', '.join(active_session.goals[:3])}")

        if working_memories:
            summary_parts.append(f"Working memory: {len(working_memories)} items")

        if recent_episodes:
            summary_parts.append(f"Recent events: {len(recent_episodes)}")

        return ContextSnapshot(
            timestamp=datetime.now(),
            working_memories=working_memories,
            recent_episodes=recent_episodes,
            conversation_context=conversation,
            active_session=active_session,
            summary=" | ".join(summary_parts) if summary_parts else "No active context",
        )

    def get_context_for_prompt(self, max_tokens: int = 1000) -> str:
        """Get context formatted for inclusion in LLM prompts.

        Args:
            max_tokens: Approximate max tokens (chars / 4).

        Returns:
            Formatted context string.
        """
        max_chars = max_tokens * 4
        context_parts = []
        current_chars = 0

        # Add active session info
        session = self.episodic.get_current_session()
        if session:
            session_info = f"[Session: {session.name}]"
            if session.goals:
                session_info += f" Goals: {', '.join(session.goals[:2])}"
            context_parts.append(session_info)
            current_chars += len(session_info)

        # Add working memory
        working = self.semantic.get_working_memory()[:5]
        if working:
            context_parts.append("\n[Working Memory]")
            for mem in working:
                if current_chars < max_chars:
                    line = f"- {mem.content[:100]}"
                    context_parts.append(line)
                    current_chars += len(line)

        # Add recent important episodes
        recent = [e for e in self.episodic.recall_recent(5) if e.importance >= 0.5]
        if recent:
            context_parts.append("\n[Recent Events]")
            for ep in recent[:3]:
                if current_chars < max_chars:
                    line = f"- {ep.description[:80]}"
                    context_parts.append(line)
                    current_chars += len(line)

        return "\n".join(context_parts)

    # ==================== Session Management ====================

    def start_session(
        self,
        name: str = "",
        goals: list[str] | None = None,
    ) -> Session:
        """Start a new session.

        Args:
            name: Session name.
            goals: Session goals.

        Returns:
            The new Session.
        """
        # Clear working memory for fresh start
        self.semantic.clear_working_memory()

        # Start episodic session
        session = self.episodic.start_session(name, goals)

        # Record in semantic memory
        self.semantic.store(
            content=f"Started session: {name}",
            memory_type=MemoryType.EPISODIC,
            priority=MemoryPriority.MEDIUM,
            tags=["session", "start"],
        )

        return session

    def end_session(
        self,
        summary: str = "",
        outcomes: list[str] | None = None,
    ) -> Session | None:
        """End the current session.

        Args:
            summary: Session summary.
            outcomes: What was achieved.

        Returns:
            The ended Session.
        """
        session = self.episodic.end_session(summary, outcomes)

        if session:
            # Store session summary in semantic memory
            self.semantic.store(
                content=f"Session completed: {session.name}. {summary}",
                memory_type=MemoryType.EPISODIC,
                priority=MemoryPriority.HIGH,
                tags=["session", "complete"],
                metadata={"session_id": session.id, "outcomes": outcomes},
            )

        return session

    # ==================== Event Recording ====================

    def record_event(
        self,
        description: str,
        event_type: EventType = EventType.CUSTOM,
        context: dict[str, Any] | None = None,
        outcome: str = "",
        success: bool | None = None,
        importance: float = 0.5,
        tags: list[str] | None = None,
    ) -> Episode:
        """Record an event/episode.

        Args:
            description: What happened.
            event_type: Type of event.
            context: Additional context.
            outcome: Result of the event.
            success: Was it successful.
            importance: How important (0.0-1.0).
            tags: Tags for categorization.

        Returns:
            The created Episode.
        """
        return self.episodic.record(
            description=description,
            event_type=event_type,
            context=context,
            outcome=outcome,
            success=success,
            importance=importance,
            tags=tags,
        )

    def record_conversation(self, role: str, content: str, **kwargs) -> None:
        """Record a conversation message.

        Args:
            role: Message role (user, assistant, etc).
            content: Message content.
            **kwargs: Additional metadata.
        """
        self.conversation.add_message(role, content, **kwargs)

        # Also record significant messages as episodes
        if len(content) > 100 or role == "user":
            self.episodic.record(
                description=f"[{role}] {content[:100]}",
                event_type=EventType.CONVERSATION,
                context={"role": role, "length": len(content)},
                importance=0.3,
            )

    # ==================== Memory Links ====================

    def _link_memory_to_episode(self, memory_id: str, episode_id: str) -> None:
        """Create a link between a memory and an episode."""
        if episode_id not in self._memory_links:
            self._memory_links[episode_id] = []
        if memory_id not in self._memory_links[episode_id]:
            self._memory_links[episode_id].append(memory_id)

    def get_memories_for_episode(self, episode_id: str) -> list[MemoryEntry]:
        """Get all memories linked to an episode.

        Args:
            episode_id: Episode ID.

        Returns:
            List of linked memories.
        """
        memory_ids = self._memory_links.get(episode_id, [])
        memories = []
        for mem_id in memory_ids:
            if mem_id in self.semantic._memories:
                memories.append(self.semantic._memories[mem_id])
        return memories

    # ==================== Reflection & Insights ====================

    def reflect(self) -> str:
        """Generate a reflection on recent memories and events.

        Returns:
            Reflection text.
        """
        reflection_parts = []

        # Today's summary
        today_summary = self.episodic.get_today_summary()
        reflection_parts.append(today_summary)

        # Memory stats
        semantic_stats = self.semantic.get_stats()
        episodic_stats = self.episodic.get_stats()

        reflection_parts.append("\n## Memory Status")
        reflection_parts.append(f"- Semantic memories: {semantic_stats['total_memories']}")
        reflection_parts.append(f"- Episodes recorded: {episodic_stats['total_episodes']}")
        reflection_parts.append(f"- Working memory: {semantic_stats['working_memory_size']} items")

        # Identify patterns (simple version)
        recent_episodes = self.episodic.recall_recent(20)
        if recent_episodes:
            success_count = sum(1 for e in recent_episodes if e.success is True)
            fail_count = sum(1 for e in recent_episodes if e.success is False)

            if success_count > 0 or fail_count > 0:
                reflection_parts.append("\n## Recent Patterns")
                reflection_parts.append(f"- Successful actions: {success_count}")
                reflection_parts.append(f"- Failed actions: {fail_count}")

        self._last_reflection = datetime.now()
        return "\n".join(reflection_parts)

    def get_insights(self) -> list[str]:
        """Generate insights from memory patterns.

        Returns:
            List of insight strings.
        """
        insights = []

        # Check for recurring topics
        all_tags = []
        for mem in self.semantic._memories.values():
            all_tags.extend(mem.tags)

        if all_tags:
            from collections import Counter
            tag_counts = Counter(all_tags)
            top_tags = tag_counts.most_common(5)
            if top_tags:
                insights.append(f"Most frequent topics: {', '.join(t for t, _ in top_tags)}")

        # Check session patterns
        sessions = list(self.episodic._sessions.values())
        if len(sessions) >= 3:
            avg_episodes = sum(len(s.episode_ids) for s in sessions) / len(sessions)
            insights.append(f"Average episodes per session: {avg_episodes:.1f}")

        # Memory health
        stats = self.semantic.get_stats()
        if stats["average_importance"] < 0.3:
            insights.append("⚠️ Many low-importance memories - consider consolidation")

        return insights

    # ==================== Cleanup & Maintenance ====================

    def consolidate(self) -> dict[str, int]:
        """Consolidate and clean up memories.

        Returns:
            Stats about what was consolidated.
        """
        stats = {"removed": 0, "consolidated": 0}

        # Trigger semantic memory consolidation
        initial_count = len(self.semantic._memories)
        self.semantic._consolidate()
        stats["removed"] = initial_count - len(self.semantic._memories)

        logger.info(f"Consolidated memories: {stats}")
        return stats

    def clear_conversation(self) -> None:
        """Clear conversation history."""
        self.conversation.clear_history()

    def clear_working_memory(self) -> None:
        """Clear working memory."""
        self.semantic.clear_working_memory()

    def get_stats(self) -> dict[str, Any]:
        """Get unified memory statistics.

        Returns:
            Combined statistics from all memory systems.
        """
        return {
            "semantic": self.semantic.get_stats(),
            "episodic": self.episodic.get_stats(),
            "conversation": {
                "message_count": len(self.conversation.history),
            },
            "links": len(self._memory_links),
        }

    def export_all(self, export_path: str) -> dict[str, int]:
        """Export all memories to files.

        Args:
            export_path: Directory to export to.

        Returns:
            Count of exported items per category.
        """
        export_dir = Path(export_path)
        export_dir.mkdir(parents=True, exist_ok=True)

        counts = {}

        # Export semantic memories
        counts["semantic"] = self.semantic.export_memories(
            str(export_dir / "semantic_memories.json")
        )

        # Export episodes
        episodes_data = {
            "episodes": [e.to_dict() for e in self.episodic._episodes.values()],
            "sessions": [s.to_dict() for s in self.episodic._sessions.values()],
        }
        (export_dir / "episodic_memories.json").write_text(
            json.dumps(episodes_data, indent=2), encoding="utf-8"
        )
        counts["episodes"] = len(self.episodic._episodes)

        # Export conversation
        conv_data = {"messages": self.conversation.get_history()}
        (export_dir / "conversation.json").write_text(
            json.dumps(conv_data, indent=2), encoding="utf-8"
        )
        counts["conversation"] = len(self.conversation.history)

        return counts
