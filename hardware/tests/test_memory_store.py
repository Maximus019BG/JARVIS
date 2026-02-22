"""Tests for core.memory.memory_store – AdvancedMemoryStore, MemoryEntry."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from core.memory.memory_store import (
    AdvancedMemoryStore,
    MemoryEntry,
    MemoryPriority,
    MemoryType,
    PRIORITY_WEIGHTS,
    _json_dumps,
    _json_loads,
)


# ---------------------------------------------------------------------------
# MemoryEntry dataclass
# ---------------------------------------------------------------------------

class TestMemoryEntry:
    def test_to_dict_roundtrip(self) -> None:
        me = MemoryEntry(
            id="m1",
            content="hello world",
            memory_type=MemoryType.SEMANTIC,
            priority=MemoryPriority.HIGH,
            tags=["test"],
            source="unit",
            context="ctx",
        )
        d = me.to_dict()
        restored = MemoryEntry.from_dict(d)
        assert restored.id == "m1"
        assert restored.content == "hello world"
        assert restored.memory_type == MemoryType.SEMANTIC
        assert restored.priority == MemoryPriority.HIGH
        assert restored.tags == ["test"]

    def test_from_dict_defaults(self) -> None:
        minimal = {
            "id": "x",
            "content": "c",
            "memory_type": "working",
        }
        me = MemoryEntry.from_dict(minimal)
        assert me.priority == MemoryPriority.MEDIUM
        assert me.tags == []
        assert me.access_count == 0
        assert me.embedding is None

    def test_calculate_importance(self) -> None:
        me = MemoryEntry(
            id="m", content="c", memory_type=MemoryType.SEMANTIC,
            priority=MemoryPriority.CRITICAL, access_count=10,
            usefulness_score=1.0,
        )
        imp = me.calculate_importance()
        assert 0.0 <= imp <= 1.0
        # Critical + high usage + high usefulness → high importance
        assert imp > 0.7

    def test_calculate_importance_low(self) -> None:
        me = MemoryEntry(
            id="m", content="c", memory_type=MemoryType.SEMANTIC,
            priority=MemoryPriority.LOW, access_count=0,
            usefulness_score=0.0,
            accessed_at=datetime.now() - timedelta(days=30),
        )
        imp = me.calculate_importance()
        assert imp < 0.3

    def test_touch(self) -> None:
        me = MemoryEntry(id="m", content="c", memory_type=MemoryType.SEMANTIC)
        old_count = me.access_count
        me.touch()
        assert me.access_count == old_count + 1

    def test_priority_weights(self) -> None:
        assert PRIORITY_WEIGHTS[MemoryPriority.CRITICAL] == 1.0
        assert PRIORITY_WEIGHTS[MemoryPriority.LOW] == 0.2

    def test_memory_type_enum(self) -> None:
        assert MemoryType.EPISODIC.value == "episodic"
        assert MemoryType.PREFERENCE.value == "preference"


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

class TestJsonHelpers:
    def test_json_dumps_loads(self) -> None:
        data = {"key": [1, 2, 3], "nested": {"a": True}}
        s = _json_dumps(data)
        restored = _json_loads(s)
        assert restored == data

    def test_json_dumps_indent(self) -> None:
        data = {"a": 1}
        s = _json_dumps(data, indent=2)
        assert "\n" in s


# ---------------------------------------------------------------------------
# AdvancedMemoryStore
# ---------------------------------------------------------------------------

class TestAdvancedMemoryStoreInit:
    def test_creates_dir(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path / "mem"))
        assert (tmp_path / "mem").is_dir()

    def test_empty_state(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        assert store._memories == {}
        assert store.get_working_memory() == []


class TestAdvancedMemoryStoreStore:
    def test_store_basic(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        entry = store.store("remember this")
        assert entry.content == "remember this"
        assert entry.memory_type == MemoryType.SEMANTIC
        assert entry.id in store._memories

    def test_store_with_params(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        entry = store.store(
            "task",
            memory_type=MemoryType.PROCEDURAL,
            priority=MemoryPriority.HIGH,
            tags=["a", "b"],
            source="test",
            context="ctx",
            metadata={"k": 1},
        )
        assert entry.memory_type == MemoryType.PROCEDURAL
        assert entry.priority == MemoryPriority.HIGH
        assert entry.tags == ["a", "b"]
        assert entry.metadata == {"k": 1}

    def test_store_high_priority_adds_to_working_memory(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        entry = store.store("urgent", priority=MemoryPriority.CRITICAL)
        wm = store.get_working_memory()
        assert any(m.id == entry.id for m in wm)

    def test_store_creates_embedding(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        entry = store.store("some text")
        assert entry.embedding is not None
        assert len(entry.embedding) == 64

    def test_store_related_to(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        e1 = store.store("first")
        e2 = store.store("second", related_to=[e1.id])
        assert e1.id in e2.related_ids
        assert e2.id in store._memories[e1.id].related_ids


class TestAdvancedMemoryStoreRecall:
    @pytest.fixture()
    def loaded_store(self, tmp_path: Path) -> AdvancedMemoryStore:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        store.store("python programming language", tags=["python", "lang"])
        store.store("javascript web framework", memory_type=MemoryType.PROCEDURAL, tags=["js"])
        store.store("python testing with pytest", tags=["python", "test"])
        return store

    def test_recall_semantic(self, loaded_store: AdvancedMemoryStore) -> None:
        results = loaded_store.recall("python")
        assert len(results) > 0
        # Should find python-related entries
        contents = [m.content for m, _ in results]
        assert any("python" in c for c in contents)

    def test_recall_empty_query(self, loaded_store: AdvancedMemoryStore) -> None:
        assert loaded_store.recall("") == []
        assert loaded_store.recall("   ") == []

    def test_recall_by_type(self, loaded_store: AdvancedMemoryStore) -> None:
        results = loaded_store.recall("web", memory_type=MemoryType.PROCEDURAL)
        assert all(m.memory_type == MemoryType.PROCEDURAL for m, _ in results)

    def test_recall_by_tags_method(self, loaded_store: AdvancedMemoryStore) -> None:
        results = loaded_store.recall_by_tags(["python"])
        assert len(results) == 2

    def test_recall_by_type_method(self, loaded_store: AdvancedMemoryStore) -> None:
        results = loaded_store.recall_by_type(MemoryType.PROCEDURAL)
        assert all(m.memory_type == MemoryType.PROCEDURAL for m in results)


class TestAdvancedMemoryStoreWorkingMemory:
    def test_add_to_working_memory(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path), working_memory_size=3)
        ids = []
        for i in range(5):
            e = store.store(f"item {i}", priority=MemoryPriority.CRITICAL)
            ids.append(e.id)
        wm = store.get_working_memory()
        assert len(wm) <= 3

    def test_clear_working_memory(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        store.store("x", priority=MemoryPriority.HIGH)
        store.clear_working_memory()
        assert store.get_working_memory() == []


class TestAdvancedMemoryStoreForget:
    def test_forget_existing(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        e = store.store("temp", tags=["t"])
        assert store.forget(e.id) is True
        assert e.id not in store._memories

    def test_forget_nonexistent(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        assert store.forget("nonexistent") is False

    def test_forget_cleans_indexes(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        e = store.store("x", tags=["tag1"], priority=MemoryPriority.CRITICAL)
        store.forget(e.id)
        assert e.id not in store._tag_index.get("tag1", set())
        assert e.id not in [mid for mid, _ in store._embedding_index]

    def test_forget_updates_related(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        e1 = store.store("first")
        e2 = store.store("second", related_to=[e1.id])
        store.forget(e2.id)
        assert e2.id not in store._memories[e1.id].related_ids


class TestAdvancedMemoryStoreUtilities:
    def test_update_usefulness(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        e = store.store("x")
        store.update_usefulness(e.id, 0.3)
        assert store._memories[e.id].usefulness_score == 0.8  # 0.5 + 0.3

    def test_update_usefulness_clamped(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        e = store.store("x")
        store.update_usefulness(e.id, 2.0)
        assert store._memories[e.id].usefulness_score == 1.0

    def test_update_usefulness_nonexistent(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        store.update_usefulness("nope", 0.1)  # should not raise

    def test_link_memories(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        e1 = store.store("one")
        e2 = store.store("two")
        assert store.link_memories(e1.id, e2.id) is True
        assert e2.id in store._memories[e1.id].related_ids
        assert e1.id in store._memories[e2.id].related_ids

    def test_link_memories_not_found(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        assert store.link_memories("a", "b") is False

    def test_get_stats(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        store.store("x", tags=["t1"])
        stats = store.get_stats()
        assert stats["total_memories"] == 1
        assert "by_type" in stats

    def test_get_context_summary(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        store.store("important fact", priority=MemoryPriority.CRITICAL)
        summary = store.get_context_summary()
        assert isinstance(summary, str)


class TestAdvancedMemoryStoreEmbedding:
    def test_compute_simple_embedding(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        emb = store._compute_simple_embedding("hello world")
        assert isinstance(emb, np.ndarray)
        assert emb.shape == (64,)
        # Normalized: magnitude ≈ 1
        mag = np.linalg.norm(emb)
        assert abs(mag - 1.0) < 1e-5

    def test_compute_embedding_empty(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        emb = store._compute_simple_embedding("")
        assert isinstance(emb, np.ndarray)

    def test_cosine_similarity_identical(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        emb = store._compute_simple_embedding("test text")
        sim = store._cosine_similarity(emb, emb)
        assert abs(sim - 1.0) < 1e-5

    def test_cosine_similarity_different(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        a = store._compute_simple_embedding("python programming")
        b = store._compute_simple_embedding("javascript web development")
        sim = store._cosine_similarity(a, b)
        assert 0.0 <= sim <= 1.0

    def test_cosine_similarity_empty(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        a = np.array([])
        b = np.array([])
        assert store._cosine_similarity(a, b) == 0.0

    def test_cosine_similarity_zero_magnitude(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(storage_path=str(tmp_path))
        a = np.zeros(64)
        b = np.ones(64)
        assert store._cosine_similarity(a, b) == 0.0


class TestAdvancedMemoryStoreConsolidation:
    def test_consolidation_trims_to_max(self, tmp_path: Path) -> None:
        store = AdvancedMemoryStore(
            storage_path=str(tmp_path),
            max_memories=5,
            consolidation_threshold=5,
        )
        # Force consolidation check interval to 1
        store._consolidation_check_interval = 1
        for i in range(10):
            store.store(f"item {i}", priority=MemoryPriority.LOW)
        assert len(store._memories) <= 5


class TestAdvancedMemoryStorePersistence:
    def test_save_and_load(self, tmp_path: Path) -> None:
        store1 = AdvancedMemoryStore(storage_path=str(tmp_path))
        e = store1.store("persist me", tags=["t1"])
        store1._save_sync()

        store2 = AdvancedMemoryStore(storage_path=str(tmp_path))
        assert e.id in store2._memories
        assert store2._memories[e.id].content == "persist me"
