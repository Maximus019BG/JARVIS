"""Tests for core.memory.memory_manager – UnifiedMemoryManager."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from core.memory.memory_manager import (
    ContextSnapshot,
    MemorySearchResult,
    UnifiedMemoryManager,
)
from core.memory.memory_store import MemoryPriority, MemoryType
from core.memory.episodic_memory import EventType


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def mm(tmp_path: Path) -> UnifiedMemoryManager:
    """Create a fresh UnifiedMemoryManager in a temp directory."""
    return UnifiedMemoryManager(storage_path=str(tmp_path / "mem"))


# ---------------------------------------------------------------------------
# MemorySearchResult
# ---------------------------------------------------------------------------

class TestMemorySearchResult:
    def test_fields(self):
        from datetime import datetime

        r = MemorySearchResult(
            source="semantic", content="foo", relevance=0.9, timestamp=datetime.now()
        )
        assert r.source == "semantic"
        assert r.metadata == {}

    def test_metadata_default(self):
        from datetime import datetime

        r = MemorySearchResult(
            source="x", content="c", relevance=0.1, timestamp=datetime.now(),
            metadata={"k": 1},
        )
        assert r.metadata == {"k": 1}


# ---------------------------------------------------------------------------
# ContextSnapshot
# ---------------------------------------------------------------------------

class TestContextSnapshot:
    def test_fields(self):
        from datetime import datetime

        snap = ContextSnapshot(
            timestamp=datetime.now(),
            working_memories=[],
            recent_episodes=[],
            conversation_context=[],
            active_session=None,
            summary="Hello",
        )
        assert snap.summary == "Hello"
        assert snap.active_session is None


# ---------------------------------------------------------------------------
# UnifiedMemoryManager – init
# ---------------------------------------------------------------------------

class TestUnifiedMemoryManagerInit:
    def test_creates_storage_dir(self, tmp_path: Path):
        p = tmp_path / "deep" / "path"
        mm = UnifiedMemoryManager(storage_path=str(p))
        assert p.exists()

    def test_subsystems_created(self, mm: UnifiedMemoryManager):
        assert mm.semantic is not None
        assert mm.episodic is not None
        assert mm.conversation is not None


# ---------------------------------------------------------------------------
# remember
# ---------------------------------------------------------------------------

class TestRemember:
    def test_basic_remember(self, mm: UnifiedMemoryManager):
        entry = mm.remember("cats are cool", tags=["animals"])
        assert entry.content == "cats are cool"
        assert "animals" in entry.tags

    def test_remember_creates_episode_link(self, mm: UnifiedMemoryManager):
        entry = mm.remember("dogs bark", record_episode=True)
        # At least one episode link should exist
        assert len(mm._memory_links) >= 1

    def test_remember_no_episode(self, mm: UnifiedMemoryManager):
        mm.remember("no episode", record_episode=False)
        # Should have no links
        assert len(mm._memory_links) == 0

    def test_remember_low_priority(self, mm: UnifiedMemoryManager):
        entry = mm.remember("low", priority=MemoryPriority.LOW)
        assert entry is not None


# ---------------------------------------------------------------------------
# recall
# ---------------------------------------------------------------------------

class TestRecall:
    def test_recall_semantic(self, mm: UnifiedMemoryManager):
        mm.remember("Python is a programming language", tags=["code"])
        results = mm.recall("Python", include_episodic=False, include_conversation=False)
        assert any(r.source == "semantic" for r in results)

    def test_recall_episodic(self, mm: UnifiedMemoryManager):
        mm.remember("event happened")
        results = mm.recall("event", include_semantic=False, include_conversation=False)
        # episodic records were created by remember()
        assert isinstance(results, list)

    def test_recall_conversation(self, mm: UnifiedMemoryManager):
        mm.conversation.add_message("user", "hello world search me")
        results = mm.recall("hello", include_semantic=False, include_episodic=False)
        assert any(r.source == "conversation" for r in results)

    def test_recall_sorted_by_relevance(self, mm: UnifiedMemoryManager):
        mm.remember("alpha high", priority=MemoryPriority.CRITICAL)
        mm.remember("beta low", priority=MemoryPriority.LOW)
        results = mm.recall("alpha")
        if len(results) >= 2:
            assert results[0].relevance >= results[1].relevance

    def test_recall_empty(self, mm: UnifiedMemoryManager):
        results = mm.recall("nonexistent")
        assert results == []


# ---------------------------------------------------------------------------
# get_context
# ---------------------------------------------------------------------------

class TestGetContext:
    def test_returns_snapshot(self, mm: UnifiedMemoryManager):
        snap = mm.get_context()
        assert isinstance(snap, ContextSnapshot)
        assert snap.summary  # always non-empty

    def test_with_session(self, mm: UnifiedMemoryManager):
        mm.episodic.start_session("Test", goals=["g1"])
        snap = mm.get_context()
        assert "Test" in snap.summary


# ---------------------------------------------------------------------------
# get_context_for_prompt
# ---------------------------------------------------------------------------

class TestGetContextForPrompt:
    def test_empty(self, mm: UnifiedMemoryManager):
        text = mm.get_context_for_prompt()
        assert isinstance(text, str)

    def test_with_session_and_memory(self, mm: UnifiedMemoryManager):
        mm.episodic.start_session("S1", goals=["build it"])
        entry = mm.semantic.store(content="working item", memory_type=MemoryType.SEMANTIC)
        mm.semantic._add_to_working_memory(entry.id)
        text = mm.get_context_for_prompt()
        assert "S1" in text or "working" in text.lower()

    def test_with_important_episodes(self, mm: UnifiedMemoryManager):
        mm.episodic.record("important thing", importance=0.9,
                           event_type=EventType.TASK_COMPLETE)
        text = mm.get_context_for_prompt()
        assert isinstance(text, str)


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

class TestSessionManagement:
    def test_start_session(self, mm: UnifiedMemoryManager):
        session = mm.start_session("my session", goals=["g"])
        assert session.name == "my session"

    def test_end_session(self, mm: UnifiedMemoryManager):
        mm.start_session("s")
        result = mm.end_session(summary="done", outcomes=["finished"])
        assert result is not None

    def test_end_session_no_active(self, mm: UnifiedMemoryManager):
        result = mm.end_session()
        assert result is None


# ---------------------------------------------------------------------------
# Event recording
# ---------------------------------------------------------------------------

class TestRecordEvent:
    def test_record_event(self, mm: UnifiedMemoryManager):
        ep = mm.record_event("something happened", importance=0.8)
        assert ep.description == "something happened"

    def test_record_conversation(self, mm: UnifiedMemoryManager):
        mm.record_conversation("user", "hello there!")
        history = mm.conversation.get_history()
        assert any("hello" in m.get("content", "") for m in history)

    def test_record_conversation_short(self, mm: UnifiedMemoryManager):
        mm.record_conversation("assistant", "hi")
        # Short assistant messages are NOT separately recorded as episodes
        # (only long or user)
        assert len(mm.conversation.get_history()) >= 1


# ---------------------------------------------------------------------------
# Memory links
# ---------------------------------------------------------------------------

class TestMemoryLinks:
    def test_link_and_retrieve(self, mm: UnifiedMemoryManager):
        entry = mm.remember("link test", record_episode=True)
        # Find the episode
        for ep_id, mem_ids in mm._memory_links.items():
            if entry.id in mem_ids:
                mems = mm.get_memories_for_episode(ep_id)
                assert any(m.id == entry.id for m in mems)
                return
        pytest.fail("Expected link not found")

    def test_get_memories_for_unknown_episode(self, mm: UnifiedMemoryManager):
        assert mm.get_memories_for_episode("nonexistent") == []


# ---------------------------------------------------------------------------
# Reflection & insights
# ---------------------------------------------------------------------------

class TestReflection:
    def test_reflect(self, mm: UnifiedMemoryManager):
        mm.remember("data point")
        text = mm.reflect()
        assert "Memory Status" in text

    def test_reflect_with_recent_episodes(self, mm: UnifiedMemoryManager):
        mm.episodic.record("success", event_type=EventType.TASK_COMPLETE, success=True,
                           importance=0.8)
        mm.episodic.record("failure", event_type=EventType.ERROR, success=False,
                           importance=0.6)
        text = mm.reflect()
        assert "Patterns" in text

    def test_get_insights_empty(self, mm: UnifiedMemoryManager):
        insights = mm.get_insights()
        assert isinstance(insights, list)

    def test_get_insights_with_tags(self, mm: UnifiedMemoryManager):
        for i in range(5):
            mm.remember(f"item {i}", tags=["python"])
        insights = mm.get_insights()
        assert any("python" in ins for ins in insights)

    def test_get_insights_low_importance(self, mm: UnifiedMemoryManager):
        for i in range(5):
            mm.semantic.store(content=f"low {i}", priority=MemoryPriority.LOW)
        insights = mm.get_insights()
        assert isinstance(insights, list)


# ---------------------------------------------------------------------------
# Cleanup & maintenance
# ---------------------------------------------------------------------------

class TestCleanup:
    def test_consolidate(self, mm: UnifiedMemoryManager):
        mm.remember("a")
        mm.remember("b")
        stats = mm.consolidate()
        assert "removed" in stats

    def test_clear_conversation(self, mm: UnifiedMemoryManager):
        mm.conversation.add_message("user", "hi")
        mm.clear_conversation()
        assert len(mm.conversation.history) == 0

    def test_clear_working_memory(self, mm: UnifiedMemoryManager):
        entry = mm.semantic.store(content="wm", memory_type=MemoryType.SEMANTIC)
        mm.semantic._add_to_working_memory(entry.id)
        mm.clear_working_memory()
        assert mm.semantic.get_working_memory() == []

    def test_get_stats(self, mm: UnifiedMemoryManager):
        mm.remember("stat test")
        stats = mm.get_stats()
        assert "semantic" in stats
        assert "episodic" in stats
        assert "conversation" in stats
        assert "links" in stats

    def test_export_all(self, mm: UnifiedMemoryManager, tmp_path: Path):
        mm.remember("export me")
        mm.conversation.add_message("user", "hi")
        export_dir = tmp_path / "export"
        counts = mm.export_all(str(export_dir))
        assert counts["semantic"] >= 1
        assert (export_dir / "episodic_memories.json").exists()
        assert (export_dir / "conversation.json").exists()
