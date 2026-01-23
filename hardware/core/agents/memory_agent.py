"""Memory Agent - Manages context, memory, and knowledge retrieval.

The memory agent specializes in:
- Storing and retrieving information
- Managing conversation context
- Long-term knowledge persistence
- Semantic search over memories
- Context summarization
- Episodic memory tracking
- Memory consolidation and insights

Supports two modes:
1. Basic mode: Simple in-memory storage with JSON persistence
2. Advanced mode: Uses UnifiedMemoryManager for semantic search,
   episodic memory, and intelligent consolidation
"""

from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, TYPE_CHECKING

from app_logging.logger import get_logger
from core.agents.base_agent import AgentResponse, AgentRole, BaseAgent

if TYPE_CHECKING:
    from core.memory import UnifiedMemoryManager

logger = get_logger(__name__)


class MemoryType(str, Enum):
    """Types of memories that can be stored."""

    CONVERSATION = "conversation"  # Chat history
    FACT = "fact"  # Specific facts
    TASK = "task"  # Task-related memory
    PREFERENCE = "preference"  # User preferences
    CONTEXT = "context"  # Session context
    KNOWLEDGE = "knowledge"  # General knowledge


class MemoryPriority(str, Enum):
    """Priority levels for memories."""

    CRITICAL = "critical"  # Never forget
    HIGH = "high"  # Remember long-term
    MEDIUM = "medium"  # Remember for session
    LOW = "low"  # Can be forgotten


@dataclass
class Memory:
    """A single memory entry."""

    id: str
    memory_type: MemoryType
    content: str
    priority: MemoryPriority = MemoryPriority.MEDIUM
    tags: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    accessed_at: str = field(default_factory=lambda: datetime.now().isoformat())
    access_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "memory_type": self.memory_type.value,
            "content": self.content,
            "priority": self.priority.value,
            "tags": self.tags,
            "created_at": self.created_at,
            "accessed_at": self.accessed_at,
            "access_count": self.access_count,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Memory:
        """Create from dictionary."""
        return cls(
            id=data["id"],
            memory_type=MemoryType(data["memory_type"]),
            content=data["content"],
            priority=MemoryPriority(data.get("priority", "medium")),
            tags=data.get("tags", []),
            created_at=data.get("created_at", datetime.now().isoformat()),
            accessed_at=data.get("accessed_at", datetime.now().isoformat()),
            access_count=data.get("access_count", 0),
            metadata=data.get("metadata", {}),
        )


class MemoryAgent(BaseAgent):
    """Agent specialized in managing memory and context.

    Handles storing, retrieving, and summarizing information
    to maintain context across conversations and sessions.
    
    Can operate in two modes:
    - Basic: Simple dict-based storage with JSON persistence
    - Advanced: Uses UnifiedMemoryManager for semantic search and episodic memory
    """

    def __init__(
        self,
        model_name: str | None = None,
        temperature: float = 0.3,
        memory_file: str = "data/memory_store.json",
        max_short_term: int = 50,
        use_advanced_memory: bool = False,
        advanced_memory_path: str = "data/advanced_memory",
    ):
        """Initialize the MemoryAgent.
        
        Args:
            model_name: LLM model to use.
            temperature: LLM temperature.
            memory_file: Path for basic memory storage.
            max_short_term: Max items in short-term memory.
            use_advanced_memory: If True, use UnifiedMemoryManager.
            advanced_memory_path: Path for advanced memory storage.
        """
        super().__init__(model_name=model_name, temperature=temperature)
        self.memory_file = Path(memory_file)
        self.memory_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Advanced memory mode
        self._use_advanced = use_advanced_memory
        self._unified_memory: UnifiedMemoryManager | None = None
        
        if use_advanced_memory:
            try:
                from core.memory import UnifiedMemoryManager
                self._unified_memory = UnifiedMemoryManager(
                    storage_path=advanced_memory_path,
                )
                logger.info("Using advanced UnifiedMemoryManager")
            except ImportError as e:
                logger.warning(f"Could not load UnifiedMemoryManager: {e}")
                self._use_advanced = False

        # Short-term memory (recent items)
        self._short_term: deque[Memory] = deque(maxlen=max_short_term)

        # Long-term memory (persistent)
        self._long_term: dict[str, Memory] = {}

        # Memory index by tags for fast lookup
        self._tag_index: dict[str, set[str]] = {}

        # Load existing memories
        self._load_memories()

        self._memory_counter = len(self._long_term)

    @property
    def role(self) -> AgentRole:
        return AgentRole.MEMORY

    @property
    def system_prompt(self) -> str:
        return """You are a memory management specialist. Your responsibilities:

1. STORE: Organize and store information efficiently
2. RETRIEVE: Find relevant memories quickly
3. SUMMARIZE: Condense information while preserving key details
4. CONTEXTUALIZE: Provide relevant context for tasks
5. FORGET: Manage memory limits by pruning less important items

MEMORY PRINCIPLES:
- Prioritize important and frequently accessed memories
- Create meaningful tags for easy retrieval
- Summarize long content to save space
- Connect related memories
- Maintain temporal awareness (what's recent vs. old)
- Respect privacy and sensitivity of information

When asked to remember something:
- Identify the memory type (fact, preference, task, etc.)
- Assign appropriate priority
- Create relevant tags
- Store concisely but completely

When asked to recall:
- Search by relevance
- Consider recency and frequency
- Provide context about when/how info was stored
- Acknowledge if information is incomplete or uncertain"""

    def _generate_id(self) -> str:
        """Generate a unique memory ID."""
        self._memory_counter += 1
        return f"mem_{self._memory_counter:06d}"

    def _load_memories(self) -> None:
        """Load memories from persistent storage."""
        if self.memory_file.exists():
            try:
                data = json.loads(self.memory_file.read_text(encoding="utf-8"))
                for mem_data in data.get("memories", []):
                    memory = Memory.from_dict(mem_data)
                    self._long_term[memory.id] = memory
                    self._index_memory(memory)
                logger.info(f"Loaded {len(self._long_term)} memories")
            except Exception as e:
                logger.error(f"Failed to load memories: {e}")

    def _save_memories(self) -> None:
        """Save memories to persistent storage."""
        try:
            data = {
                "version": "1.0",
                "saved_at": datetime.now().isoformat(),
                "memories": [m.to_dict() for m in self._long_term.values()],
            }
            self.memory_file.write_text(
                json.dumps(data, indent=2), encoding="utf-8"
            )
            logger.debug(f"Saved {len(self._long_term)} memories")
        except Exception as e:
            logger.error(f"Failed to save memories: {e}")

    def _index_memory(self, memory: Memory) -> None:
        """Add memory to tag index."""
        for tag in memory.tags:
            if tag not in self._tag_index:
                self._tag_index[tag] = set()
            self._tag_index[tag].add(memory.id)

    def _unindex_memory(self, memory: Memory) -> None:
        """Remove memory from tag index."""
        for tag in memory.tags:
            if tag in self._tag_index:
                self._tag_index[tag].discard(memory.id)

    def store(
        self,
        content: str,
        memory_type: MemoryType = MemoryType.FACT,
        priority: MemoryPriority = MemoryPriority.MEDIUM,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Memory:
        """Store a new memory.

        Args:
            content: The content to remember.
            memory_type: Type of memory.
            priority: Priority level.
            tags: Tags for categorization.
            metadata: Additional metadata.

        Returns:
            The created Memory object.
        """
        memory = Memory(
            id=self._generate_id(),
            memory_type=memory_type,
            content=content,
            priority=priority,
            tags=tags or [],
            metadata=metadata or {},
        )

        # Add to short-term
        self._short_term.append(memory)

        # Add to long-term if priority is high enough
        if priority in (MemoryPriority.CRITICAL, MemoryPriority.HIGH):
            self._long_term[memory.id] = memory
            self._index_memory(memory)
            self._save_memories()

        logger.info(f"Stored memory {memory.id}: {content[:50]}...")
        return memory

    def recall(
        self,
        query: str,
        memory_type: MemoryType | None = None,
        tags: list[str] | None = None,
        limit: int = 10,
    ) -> list[Memory]:
        """Recall memories matching criteria.

        Args:
            query: Search query.
            memory_type: Filter by type.
            tags: Filter by tags.
            limit: Maximum number of results.

        Returns:
            List of matching memories.
        """
        results: list[Memory] = []
        query_lower = query.lower()

        # Search both short-term and long-term
        all_memories = list(self._short_term) + list(self._long_term.values())

        for memory in all_memories:
            # Filter by type
            if memory_type and memory.memory_type != memory_type:
                continue

            # Filter by tags
            if tags and not any(t in memory.tags for t in tags):
                continue

            # Search in content
            if query_lower in memory.content.lower():
                results.append(memory)
                # Update access info
                memory.accessed_at = datetime.now().isoformat()
                memory.access_count += 1

        # Sort by relevance (access count + recency)
        results.sort(key=lambda m: (m.access_count, m.accessed_at), reverse=True)

        return results[:limit]

    def recall_by_tags(self, tags: list[str], limit: int = 10) -> list[Memory]:
        """Recall memories by tags.

        Args:
            tags: Tags to search for.
            limit: Maximum results.

        Returns:
            List of matching memories.
        """
        memory_ids: set[str] = set()
        for tag in tags:
            if tag in self._tag_index:
                memory_ids.update(self._tag_index[tag])

        results = [
            self._long_term[mid]
            for mid in memory_ids
            if mid in self._long_term
        ]

        return results[:limit]

    def forget(self, memory_id: str) -> bool:
        """Forget (delete) a memory.

        Args:
            memory_id: ID of memory to forget.

        Returns:
            True if forgotten, False if not found.
        """
        if memory_id in self._long_term:
            memory = self._long_term.pop(memory_id)
            self._unindex_memory(memory)
            self._save_memories()
            logger.info(f"Forgot memory {memory_id}")
            return True
        return False

    def get_context(
        self,
        task: str,
        max_items: int = 5,
    ) -> list[Memory]:
        """Get relevant context for a task.

        Args:
            task: The task to get context for.
            max_items: Maximum context items.

        Returns:
            List of relevant memories.
        """
        # Get recent short-term memories
        recent = list(self._short_term)[-max_items:]

        # Search for relevant long-term memories
        relevant = self.recall(task, limit=max_items)

        # Combine and deduplicate
        seen_ids = set()
        context = []
        for memory in recent + relevant:
            if memory.id not in seen_ids:
                seen_ids.add(memory.id)
                context.append(memory)

        return context[:max_items]

    async def remember(
        self,
        content: str,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Intelligently remember information.

        Uses LLM to extract key facts and determine importance.

        Args:
            content: Content to remember.
            context: Additional context.

        Returns:
            AgentResponse with what was remembered.
        """
        prompt = f"""Analyze this information and extract what should be remembered:

{content}

Respond with:
1. Key facts to remember (as a list)
2. Suggested tags for categorization
3. Priority level (critical/high/medium/low)
4. Memory type (fact/preference/task/context)
"""

        response = await self.process(prompt, context)

        # Store the original content as a memory
        memory = self.store(
            content=content,
            memory_type=MemoryType.KNOWLEDGE,
            priority=MemoryPriority.MEDIUM,
            tags=["auto-stored"],
        )

        response.metadata["memory_id"] = memory.id
        return response

    async def recall_with_context(
        self,
        query: str,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Recall memories with LLM-enhanced context.

        Args:
            query: What to recall.
            context: Additional context.

        Returns:
            AgentResponse with recalled information.
        """
        # Get matching memories
        memories = self.recall(query, limit=10)

        if not memories:
            return AgentResponse(
                content="I don't have any memories matching that query.",
                agent_role=self.role,
                success=True,
                metadata={"memories_found": 0},
            )

        # Format memories for LLM
        memories_str = "\n".join(
            f"- [{m.memory_type.value}] {m.content} (tags: {', '.join(m.tags)})"
            for m in memories
        )

        prompt = f"""Based on these memories, answer the query:

QUERY: {query}

MEMORIES:
{memories_str}

Synthesize a helpful response using the relevant memories.
"""

        response = await self.process(prompt, context)
        response.metadata["memories_found"] = len(memories)
        return response

    async def summarize_context(
        self,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Summarize current memory context.

        Args:
            context: Additional context.

        Returns:
            AgentResponse with context summary.
        """
        # Get recent and important memories
        recent = list(self._short_term)[-10:]
        important = [
            m for m in self._long_term.values()
            if m.priority in (MemoryPriority.CRITICAL, MemoryPriority.HIGH)
        ]

        all_content = "\n".join(
            f"- {m.content}" for m in (recent + important)
        )

        prompt = f"""Summarize this context into key points:

{all_content}

Provide:
1. Main topics/themes
2. Key facts
3. Current task context (if any)
4. Important preferences or constraints
"""

        return await self.process(prompt, context)

    def get_stats(self) -> dict[str, Any]:
        """Get memory statistics.

        Returns:
            Dictionary with memory stats.
        """
        return {
            "short_term_count": len(self._short_term),
            "long_term_count": len(self._long_term),
            "total_tags": len(self._tag_index),
            "by_type": {
                mt.value: sum(
                    1 for m in self._long_term.values()
                    if m.memory_type == mt
                )
                for mt in MemoryType
            },
            "by_priority": {
                mp.value: sum(
                    1 for m in self._long_term.values()
                    if m.priority == mp
                )
                for mp in MemoryPriority
            },
        }

    def clear_short_term(self) -> None:
        """Clear short-term memory."""
        self._short_term.clear()
        logger.info("Cleared short-term memory")

    def clear_all(self) -> None:
        """Clear all memories (use with caution)."""
        self._short_term.clear()
        self._long_term.clear()
        self._tag_index.clear()
        self._save_memories()
        
        if self._unified_memory:
            self._unified_memory.clear_conversation()
            self._unified_memory.clear_working_memory()
            
        logger.warning("Cleared all memories")

    # ==================== Advanced Memory Methods ====================

    def semantic_search(
        self,
        query: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Perform semantic search across memories.
        
        Requires advanced memory mode to be enabled.
        
        Args:
            query: Search query.
            limit: Maximum results.
            
        Returns:
            List of search results with relevance scores.
        """
        if not self._unified_memory:
            # Fall back to basic search
            memories = self.recall(query, limit=limit)
            return [
                {
                    "content": m.content,
                    "relevance": 0.5,
                    "source": "basic",
                    "tags": m.tags,
                }
                for m in memories
            ]
        
        results = self._unified_memory.recall(
            query,
            include_semantic=True,
            include_episodic=True,
            include_conversation=False,
            limit=limit,
        )
        
        return [
            {
                "content": r.content,
                "relevance": r.relevance,
                "source": r.source,
                "timestamp": r.timestamp.isoformat(),
                "metadata": r.metadata,
            }
            for r in results
        ]

    def get_context_for_prompt(self, max_tokens: int = 1000) -> str:
        """Get context formatted for LLM prompts.
        
        Args:
            max_tokens: Approximate max tokens.
            
        Returns:
            Formatted context string.
        """
        if self._unified_memory:
            return self._unified_memory.get_context_for_prompt(max_tokens)
        
        # Basic fallback
        context_parts = []
        for memory in list(self._short_term)[-5:]:
            context_parts.append(f"- {memory.content[:100]}")
        
        return "[Recent Context]\n" + "\n".join(context_parts)

    def start_session(
        self,
        name: str = "",
        goals: list[str] | None = None,
    ) -> dict[str, Any]:
        """Start a new memory session.
        
        Args:
            name: Session name.
            goals: Session goals.
            
        Returns:
            Session info dict.
        """
        if self._unified_memory:
            session = self._unified_memory.start_session(name, goals)
            return {
                "id": session.id,
                "name": session.name,
                "started_at": session.started_at.isoformat(),
                "goals": session.goals,
            }
        
        # Basic mode just clears short-term
        self.clear_short_term()
        return {
            "id": "basic_session",
            "name": name,
            "started_at": datetime.now().isoformat(),
            "goals": goals or [],
        }

    def end_session(
        self,
        summary: str = "",
        outcomes: list[str] | None = None,
    ) -> dict[str, Any]:
        """End the current session.
        
        Args:
            summary: Session summary.
            outcomes: What was achieved.
            
        Returns:
            Session info dict.
        """
        if self._unified_memory:
            session = self._unified_memory.end_session(summary, outcomes)
            if session:
                return {
                    "id": session.id,
                    "name": session.name,
                    "duration": str(session.ended_at - session.started_at) if session.ended_at else None,
                    "outcomes": session.outcomes,
                }
        
        return {"status": "session_ended"}

    def record_event(
        self,
        description: str,
        event_type: str = "custom",
        success: bool | None = None,
        importance: float = 0.5,
    ) -> dict[str, Any]:
        """Record an event/episode in memory.
        
        Args:
            description: What happened.
            event_type: Type of event.
            success: Was it successful.
            importance: Importance (0.0-1.0).
            
        Returns:
            Event info dict.
        """
        if self._unified_memory:
            from core.memory import EventType
            
            try:
                etype = EventType(event_type)
            except ValueError:
                etype = EventType.CUSTOM
            
            episode = self._unified_memory.record_event(
                description=description,
                event_type=etype,
                success=success,
                importance=importance,
            )
            
            return {
                "id": episode.id,
                "description": episode.description,
                "type": episode.event_type.value,
                "timestamp": episode.timestamp.isoformat(),
            }
        
        # Basic mode stores as memory
        memory = self.store(
            content=description,
            memory_type=MemoryType.CONTEXT,
            priority=MemoryPriority.MEDIUM,
            tags=["event", event_type],
        )
        
        return {
            "id": memory.id,
            "description": description,
            "type": event_type,
            "timestamp": memory.created_at,
        }

    def reflect(self) -> str:
        """Generate a reflection on recent memories.
        
        Returns:
            Reflection text.
        """
        if self._unified_memory:
            return self._unified_memory.reflect()
        
        # Basic reflection
        stats = self.get_stats()
        return f"""## Memory Reflection
- Short-term memories: {stats['short_term_count']}
- Long-term memories: {stats['long_term_count']}
- Total tags: {stats['total_tags']}
"""

    def get_insights(self) -> list[str]:
        """Get insights from memory patterns.
        
        Returns:
            List of insight strings.
        """
        if self._unified_memory:
            return self._unified_memory.get_insights()
        
        # Basic insights
        insights = []
        
        if len(self._long_term) > 100:
            insights.append(f"📚 Large memory store: {len(self._long_term)} memories")
        
        if self._tag_index:
            top_tags = sorted(
                self._tag_index.items(),
                key=lambda x: len(x[1]),
                reverse=True,
            )[:5]
            if top_tags:
                insights.append(
                    f"🏷️ Top tags: {', '.join(t for t, _ in top_tags)}"
                )
        
        return insights

    def consolidate(self) -> dict[str, int]:
        """Consolidate and clean up memories.
        
        Returns:
            Stats about consolidation.
        """
        if self._unified_memory:
            return self._unified_memory.consolidate()
        
        # Basic consolidation: remove old low-priority memories
        to_remove = []
        for mem_id, memory in self._long_term.items():
            if memory.priority == MemoryPriority.LOW and memory.access_count < 2:
                to_remove.append(mem_id)
        
        for mem_id in to_remove:
            self.forget(mem_id)
        
        return {"removed": len(to_remove), "consolidated": 0}

    def export_all(self, export_path: str) -> dict[str, int]:
        """Export all memories to files.
        
        Args:
            export_path: Directory to export to.
            
        Returns:
            Count of exported items.
        """
        if self._unified_memory:
            return self._unified_memory.export_all(export_path)
        
        # Basic export
        export_dir = Path(export_path)
        export_dir.mkdir(parents=True, exist_ok=True)
        
        data = {
            "memories": [m.to_dict() for m in self._long_term.values()],
            "exported_at": datetime.now().isoformat(),
        }
        
        (export_dir / "memories.json").write_text(
            json.dumps(data, indent=2), encoding="utf-8"
        )
        
        return {"memories": len(self._long_term)}

    @property
    def is_advanced_mode(self) -> bool:
        """Check if using advanced memory mode."""
        return self._use_advanced and self._unified_memory is not None
