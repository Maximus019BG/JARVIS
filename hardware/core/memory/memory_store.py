"""Advanced memory store with semantic search and vector embeddings.

Provides sophisticated memory management with:
- Vector-based semantic search
- Memory consolidation and summarization
- Importance decay over time
- Relationship graphs between memories
- Contextual retrieval
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from app_logging.logger import get_logger

logger = get_logger(__name__)


class MemoryType(str, Enum):
    """Types of memories that can be stored."""

    EPISODIC = "episodic"  # Events and experiences
    SEMANTIC = "semantic"  # Facts and knowledge
    PROCEDURAL = "procedural"  # How to do things
    WORKING = "working"  # Current task context
    PREFERENCE = "preference"  # User preferences


class MemoryPriority(str, Enum):
    """Priority levels for memories."""

    CRITICAL = "critical"  # Never forget (weight: 1.0)
    HIGH = "high"  # Very important (weight: 0.8)
    MEDIUM = "medium"  # Normal (weight: 0.5)
    LOW = "low"  # Can be forgotten (weight: 0.2)


# Priority weights for importance calculations
PRIORITY_WEIGHTS = {
    MemoryPriority.CRITICAL: 1.0,
    MemoryPriority.HIGH: 0.8,
    MemoryPriority.MEDIUM: 0.5,
    MemoryPriority.LOW: 0.2,
}


@dataclass
class MemoryEntry:
    """A single memory entry with rich metadata."""

    id: str
    content: str
    memory_type: MemoryType
    priority: MemoryPriority = MemoryPriority.MEDIUM

    # Metadata
    tags: list[str] = field(default_factory=list)
    source: str = ""  # Where this memory came from
    context: str = ""  # Surrounding context when created

    # Timestamps
    created_at: datetime = field(default_factory=datetime.now)
    accessed_at: datetime = field(default_factory=datetime.now)
    modified_at: datetime = field(default_factory=datetime.now)

    # Usage tracking
    access_count: int = 0
    usefulness_score: float = 0.5  # 0.0 to 1.0, updated based on feedback

    # Relationships
    related_ids: list[str] = field(default_factory=list)
    parent_id: str | None = None  # For hierarchical memories
    children_ids: list[str] = field(default_factory=list)

    # Vector embedding (for semantic search)
    embedding: list[float] | None = None

    # Additional data
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "id": self.id,
            "content": self.content,
            "memory_type": self.memory_type.value,
            "priority": self.priority.value,
            "tags": self.tags,
            "source": self.source,
            "context": self.context,
            "created_at": self.created_at.isoformat(),
            "accessed_at": self.accessed_at.isoformat(),
            "modified_at": self.modified_at.isoformat(),
            "access_count": self.access_count,
            "usefulness_score": self.usefulness_score,
            "related_ids": self.related_ids,
            "parent_id": self.parent_id,
            "children_ids": self.children_ids,
            "embedding": self.embedding,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MemoryEntry:
        """Create from dictionary."""
        return cls(
            id=data["id"],
            content=data["content"],
            memory_type=MemoryType(data["memory_type"]),
            priority=MemoryPriority(data.get("priority", "medium")),
            tags=data.get("tags", []),
            source=data.get("source", ""),
            context=data.get("context", ""),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.now(),
            accessed_at=datetime.fromisoformat(data["accessed_at"]) if data.get("accessed_at") else datetime.now(),
            modified_at=datetime.fromisoformat(data["modified_at"]) if data.get("modified_at") else datetime.now(),
            access_count=data.get("access_count", 0),
            usefulness_score=data.get("usefulness_score", 0.5),
            related_ids=data.get("related_ids", []),
            parent_id=data.get("parent_id"),
            children_ids=data.get("children_ids", []),
            embedding=data.get("embedding"),
            metadata=data.get("metadata", {}),
        )

    def calculate_importance(self) -> float:
        """Calculate current importance score based on multiple factors.

        Returns:
            Importance score between 0.0 and 1.0.
        """
        # Base priority weight
        priority_weight = PRIORITY_WEIGHTS.get(self.priority, 0.5)

        # Recency factor (exponential decay over 7 days)
        age = (datetime.now() - self.accessed_at).total_seconds()
        recency_factor = math.exp(-age / (7 * 24 * 3600))

        # Access frequency factor (normalized)
        frequency_factor = min(1.0, self.access_count / 10.0)

        # Usefulness from feedback
        usefulness_factor = self.usefulness_score

        # Combine factors with weights
        importance = (
            0.3 * priority_weight
            + 0.25 * recency_factor
            + 0.2 * frequency_factor
            + 0.25 * usefulness_factor
        )

        return min(1.0, max(0.0, importance))

    def touch(self) -> None:
        """Update access time and count."""
        self.accessed_at = datetime.now()
        self.access_count += 1


class AdvancedMemoryStore:
    """Advanced memory store with semantic search and intelligent retrieval.

    Features:
    - Vector-based semantic similarity search
    - Automatic memory consolidation
    - Importance-based forgetting
    - Relationship tracking between memories
    - Working memory for current context
    """

    def __init__(
        self,
        storage_path: str = "data/memory",
        max_memories: int = 10000,
        working_memory_size: int = 20,
        consolidation_threshold: int = 100,
    ):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)

        self.max_memories = max_memories
        self.working_memory_size = working_memory_size
        self.consolidation_threshold = consolidation_threshold

        # Main storage
        self._memories: dict[str, MemoryEntry] = {}

        # Indexes for fast lookup
        self._tag_index: dict[str, set[str]] = defaultdict(set)
        self._type_index: dict[MemoryType, set[str]] = defaultdict(set)
        self._embedding_index: list[tuple[str, list[float]]] = []

        # Working memory (current context)
        self._working_memory: list[str] = []

        # Memory counter for ID generation
        self._counter = 0

        # Load existing memories
        self._load()

    def _generate_id(self) -> str:
        """Generate a unique memory ID."""
        self._counter += 1
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        return f"mem_{timestamp}_{self._counter:06d}"

    def _compute_simple_embedding(self, text: str) -> list[float]:
        """Compute a simple text embedding using character and word features.

        This is a basic embedding for when no ML model is available.
        For production, use sentence-transformers or similar.

        Args:
            text: Text to embed.

        Returns:
            A list of floats representing the text.
        """
        # Normalize text
        text = text.lower().strip()
        words = text.split()

        # Feature vector (64 dimensions)
        embedding = [0.0] * 64

        # Character-based features (first 26 dimensions)
        for char in text:
            if 'a' <= char <= 'z':
                idx = ord(char) - ord('a')
                embedding[idx] += 1

        # Word-based features
        embedding[26] = len(words)  # Word count
        embedding[27] = len(text)  # Character count
        embedding[28] = sum(len(w) for w in words) / max(1, len(words))  # Avg word length

        # Simple hash-based features for remaining dimensions
        text_hash = hashlib.md5(text.encode()).hexdigest()
        for i in range(29, 64):
            embedding[i] = int(text_hash[(i - 29) % 32], 16) / 15.0

        # Normalize
        magnitude = math.sqrt(sum(x * x for x in embedding))
        if magnitude > 0:
            embedding = [x / magnitude for x in embedding]

        return embedding

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        """Compute cosine similarity between two vectors."""
        if not a or not b or len(a) != len(b):
            return 0.0

        dot_product = sum(x * y for x, y in zip(a, b))
        magnitude_a = math.sqrt(sum(x * x for x in a))
        magnitude_b = math.sqrt(sum(x * x for x in b))

        if magnitude_a == 0 or magnitude_b == 0:
            return 0.0

        return dot_product / (magnitude_a * magnitude_b)

    def store(
        self,
        content: str,
        memory_type: MemoryType = MemoryType.SEMANTIC,
        priority: MemoryPriority = MemoryPriority.MEDIUM,
        tags: list[str] | None = None,
        source: str = "",
        context: str = "",
        related_to: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> MemoryEntry:
        """Store a new memory.

        Args:
            content: The content to remember.
            memory_type: Type of memory.
            priority: Priority level.
            tags: Tags for categorization.
            source: Where this memory came from.
            context: Surrounding context.
            related_to: IDs of related memories.
            metadata: Additional metadata.

        Returns:
            The created MemoryEntry.
        """
        memory_id = self._generate_id()

        # Compute embedding for semantic search
        embedding = self._compute_simple_embedding(content)

        memory = MemoryEntry(
            id=memory_id,
            content=content,
            memory_type=memory_type,
            priority=priority,
            tags=tags or [],
            source=source,
            context=context,
            related_ids=related_to or [],
            embedding=embedding,
            metadata=metadata or {},
        )

        # Store memory
        self._memories[memory_id] = memory

        # Update indexes
        for tag in memory.tags:
            self._tag_index[tag].add(memory_id)
        self._type_index[memory_type].add(memory_id)
        self._embedding_index.append((memory_id, embedding))

        # Add to working memory if high priority
        if priority in (MemoryPriority.CRITICAL, MemoryPriority.HIGH):
            self._add_to_working_memory(memory_id)

        # Update relationships
        for related_id in memory.related_ids:
            if related_id in self._memories:
                self._memories[related_id].related_ids.append(memory_id)

        # Check if consolidation is needed
        if len(self._memories) >= self.consolidation_threshold:
            self._consolidate()

        # Save to disk
        self._save()

        logger.info(f"Stored memory {memory_id}: {content[:50]}...")
        return memory

    def recall(
        self,
        query: str,
        memory_type: MemoryType | None = None,
        tags: list[str] | None = None,
        limit: int = 10,
        min_similarity: float = 0.3,
        include_related: bool = True,
    ) -> list[tuple[MemoryEntry, float]]:
        """Recall memories matching a query using semantic search.

        Args:
            query: Search query.
            memory_type: Filter by type.
            tags: Filter by tags.
            limit: Maximum results.
            min_similarity: Minimum similarity threshold.
            include_related: Whether to include related memories.

        Returns:
            List of (memory, similarity_score) tuples.
        """
        if not query.strip():
            return []

        query_embedding = self._compute_simple_embedding(query)
        results: list[tuple[MemoryEntry, float]] = []

        for memory_id, embedding in self._embedding_index:
            if memory_id not in self._memories:
                continue

            memory = self._memories[memory_id]

            # Apply filters
            if memory_type and memory.memory_type != memory_type:
                continue

            if tags and not any(t in memory.tags for t in tags):
                continue

            # Compute similarity
            similarity = self._cosine_similarity(query_embedding, embedding)

            if similarity >= min_similarity:
                results.append((memory, similarity))

        # Sort by similarity (descending) and importance
        results.sort(key=lambda x: (x[1], x[0].calculate_importance()), reverse=True)

        # Get top results
        top_results = results[:limit]

        # Update access info
        for memory, _ in top_results:
            memory.touch()

        # Include related memories if requested
        if include_related:
            related_ids = set()
            for memory, _ in top_results:
                related_ids.update(memory.related_ids)

            for related_id in related_ids:
                if related_id in self._memories:
                    related_memory = self._memories[related_id]
                    if not any(m.id == related_id for m, _ in top_results):
                        # Add with lower score
                        top_results.append((related_memory, 0.2))

        self._save()
        return top_results[:limit]

    def recall_by_tags(self, tags: list[str], limit: int = 10) -> list[MemoryEntry]:
        """Recall memories by tags.

        Args:
            tags: Tags to search for.
            limit: Maximum results.

        Returns:
            List of matching memories.
        """
        memory_ids: set[str] = set()
        for tag in tags:
            memory_ids.update(self._tag_index.get(tag, set()))

        results = [
            self._memories[mid]
            for mid in memory_ids
            if mid in self._memories
        ]

        # Sort by importance
        results.sort(key=lambda m: m.calculate_importance(), reverse=True)

        # Update access
        for memory in results[:limit]:
            memory.touch()

        self._save()
        return results[:limit]

    def recall_by_type(
        self,
        memory_type: MemoryType,
        limit: int = 10,
    ) -> list[MemoryEntry]:
        """Recall memories by type.

        Args:
            memory_type: Type to filter by.
            limit: Maximum results.

        Returns:
            List of matching memories.
        """
        memory_ids = self._type_index.get(memory_type, set())

        results = [
            self._memories[mid]
            for mid in memory_ids
            if mid in self._memories
        ]

        results.sort(key=lambda m: m.calculate_importance(), reverse=True)

        for memory in results[:limit]:
            memory.touch()

        self._save()
        return results[:limit]

    def get_working_memory(self) -> list[MemoryEntry]:
        """Get current working memory context.

        Returns:
            List of memories in working memory.
        """
        return [
            self._memories[mid]
            for mid in self._working_memory
            if mid in self._memories
        ]

    def _add_to_working_memory(self, memory_id: str) -> None:
        """Add a memory to working memory."""
        if memory_id in self._working_memory:
            self._working_memory.remove(memory_id)
        self._working_memory.insert(0, memory_id)

        # Trim to size
        while len(self._working_memory) > self.working_memory_size:
            self._working_memory.pop()

    def clear_working_memory(self) -> None:
        """Clear working memory."""
        self._working_memory = []

    def forget(self, memory_id: str) -> bool:
        """Forget (delete) a memory.

        Args:
            memory_id: ID of memory to forget.

        Returns:
            True if forgotten, False if not found.
        """
        if memory_id not in self._memories:
            return False

        memory = self._memories.pop(memory_id)

        # Update indexes
        for tag in memory.tags:
            self._tag_index[tag].discard(memory_id)
        self._type_index[memory.memory_type].discard(memory_id)
        self._embedding_index = [
            (mid, emb) for mid, emb in self._embedding_index
            if mid != memory_id
        ]

        # Remove from working memory
        if memory_id in self._working_memory:
            self._working_memory.remove(memory_id)

        # Update related memories
        for related_id in memory.related_ids:
            if related_id in self._memories:
                self._memories[related_id].related_ids = [
                    rid for rid in self._memories[related_id].related_ids
                    if rid != memory_id
                ]

        self._save()
        logger.info(f"Forgot memory {memory_id}")
        return True

    def update_usefulness(self, memory_id: str, delta: float) -> None:
        """Update the usefulness score of a memory.

        Args:
            memory_id: Memory to update.
            delta: Change in usefulness (-1.0 to 1.0).
        """
        if memory_id in self._memories:
            memory = self._memories[memory_id]
            memory.usefulness_score = max(0.0, min(1.0, memory.usefulness_score + delta))
            memory.modified_at = datetime.now()
            self._save()

    def link_memories(self, memory_id_1: str, memory_id_2: str) -> bool:
        """Create a bidirectional link between two memories.

        Args:
            memory_id_1: First memory ID.
            memory_id_2: Second memory ID.

        Returns:
            True if linked, False if either not found.
        """
        if memory_id_1 not in self._memories or memory_id_2 not in self._memories:
            return False

        mem1 = self._memories[memory_id_1]
        mem2 = self._memories[memory_id_2]

        if memory_id_2 not in mem1.related_ids:
            mem1.related_ids.append(memory_id_2)
        if memory_id_1 not in mem2.related_ids:
            mem2.related_ids.append(memory_id_1)

        self._save()
        return True

    def _consolidate(self) -> None:
        """Consolidate memories by removing low-importance ones.

        This implements a forgetting curve - less important and
        less accessed memories are gradually forgotten.
        """
        if len(self._memories) <= self.max_memories:
            return

        # Calculate importance for all memories
        scored_memories = [
            (memory_id, self._memories[memory_id].calculate_importance())
            for memory_id in self._memories
        ]

        # Sort by importance (ascending - lowest first)
        scored_memories.sort(key=lambda x: x[1])

        # Remove lowest importance memories until under limit
        to_remove = len(self._memories) - self.max_memories
        for memory_id, importance in scored_memories[:to_remove]:
            memory = self._memories[memory_id]
            # Don't remove critical memories
            if memory.priority != MemoryPriority.CRITICAL:
                self.forget(memory_id)
                logger.debug(f"Consolidated memory {memory_id} (importance: {importance:.3f})")

    def get_context_summary(self, max_items: int = 5) -> str:
        """Get a summary of current context from working memory.

        Args:
            max_items: Maximum items to include.

        Returns:
            Summary string.
        """
        working = self.get_working_memory()[:max_items]

        if not working:
            return "No current context."

        summary_parts = ["Current context:"]
        for memory in working:
            summary_parts.append(f"- [{memory.memory_type.value}] {memory.content[:100]}")

        return "\n".join(summary_parts)

    def get_stats(self) -> dict[str, Any]:
        """Get memory statistics.

        Returns:
            Dictionary with statistics.
        """
        return {
            "total_memories": len(self._memories),
            "working_memory_size": len(self._working_memory),
            "total_tags": len(self._tag_index),
            "by_type": {
                mt.value: len(self._type_index.get(mt, set()))
                for mt in MemoryType
            },
            "by_priority": {
                mp.value: sum(
                    1 for m in self._memories.values()
                    if m.priority == mp
                )
                for mp in MemoryPriority
            },
            "average_importance": sum(
                m.calculate_importance() for m in self._memories.values()
            ) / max(1, len(self._memories)),
        }

    def _save(self) -> None:
        """Save memories to disk."""
        try:
            data = {
                "version": "2.0",
                "saved_at": datetime.now().isoformat(),
                "counter": self._counter,
                "working_memory": self._working_memory,
                "memories": [m.to_dict() for m in self._memories.values()],
            }

            file_path = self.storage_path / "memory_store.json"
            file_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

        except Exception as e:
            logger.error(f"Failed to save memories: {e}")

    def _load(self) -> None:
        """Load memories from disk."""
        file_path = self.storage_path / "memory_store.json"

        if not file_path.exists():
            return

        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))

            self._counter = data.get("counter", 0)
            self._working_memory = data.get("working_memory", [])

            for mem_data in data.get("memories", []):
                memory = MemoryEntry.from_dict(mem_data)
                self._memories[memory.id] = memory

                # Rebuild indexes
                for tag in memory.tags:
                    self._tag_index[tag].add(memory.id)
                self._type_index[memory.memory_type].add(memory.id)
                if memory.embedding:
                    self._embedding_index.append((memory.id, memory.embedding))

            logger.info(f"Loaded {len(self._memories)} memories")

        except Exception as e:
            logger.error(f"Failed to load memories: {e}")

    def export_memories(self, file_path: str) -> int:
        """Export all memories to a file.

        Args:
            file_path: Path to export file.

        Returns:
            Number of memories exported.
        """
        data = {
            "exported_at": datetime.now().isoformat(),
            "memories": [m.to_dict() for m in self._memories.values()],
        }

        Path(file_path).write_text(json.dumps(data, indent=2), encoding="utf-8")
        return len(self._memories)

    def import_memories(self, file_path: str) -> int:
        """Import memories from a file.

        Args:
            file_path: Path to import file.

        Returns:
            Number of memories imported.
        """
        data = json.loads(Path(file_path).read_text(encoding="utf-8"))
        count = 0

        for mem_data in data.get("memories", []):
            # Generate new ID to avoid conflicts
            old_id = mem_data["id"]
            mem_data["id"] = self._generate_id()

            memory = MemoryEntry.from_dict(mem_data)
            self._memories[memory.id] = memory

            # Update indexes
            for tag in memory.tags:
                self._tag_index[tag].add(memory.id)
            self._type_index[memory.memory_type].add(memory.id)
            if memory.embedding:
                self._embedding_index.append((memory.id, memory.embedding))

            count += 1

        self._save()
        return count
