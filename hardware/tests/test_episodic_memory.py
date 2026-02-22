"""Tests for core.memory.episodic_memory – EpisodicMemory, Episode, Session."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

from core.memory.episodic_memory import (
    Episode,
    EpisodicMemory,
    EventType,
    Session,
)


# ---------------------------------------------------------------------------
# Episode dataclass
# ---------------------------------------------------------------------------

class TestEpisode:
    def test_to_dict_roundtrip(self) -> None:
        ep = Episode(
            id="ep_001",
            event_type=EventType.TASK_COMPLETE,
            description="built widget",
            context={"tool": "hammer"},
            participants=["user"],
            outcome="done",
            success=True,
            importance=0.8,
            tags=["build"],
        )
        d = ep.to_dict()
        restored = Episode.from_dict(d)
        assert restored.id == ep.id
        assert restored.event_type == EventType.TASK_COMPLETE
        assert restored.description == "built widget"
        assert restored.context == {"tool": "hammer"}
        assert restored.participants == ["user"]
        assert restored.outcome == "done"
        assert restored.success is True
        assert restored.importance == 0.8
        assert restored.tags == ["build"]

    def test_from_dict_defaults(self) -> None:
        minimal = {"id": "x", "event_type": "custom", "description": "hi"}
        ep = Episode.from_dict(minimal)
        assert ep.id == "x"
        assert ep.event_type == EventType.CUSTOM
        assert ep.participants == []
        assert ep.success is None
        assert ep.importance == 0.5

    def test_event_type_enum_values(self) -> None:
        assert EventType.CONVERSATION.value == "conversation"
        assert EventType.TASK_START.value == "task_start"
        assert EventType.ERROR.value == "error"


# ---------------------------------------------------------------------------
# Session dataclass
# ---------------------------------------------------------------------------

class TestSession:
    def test_to_dict_roundtrip(self) -> None:
        now = datetime.now()
        s = Session(id="s1", name="test", start_time=now, goals=["a"])
        d = s.to_dict()
        restored = Session.from_dict(d)
        assert restored.id == "s1"
        assert restored.name == "test"
        assert restored.goals == ["a"]

    def test_is_active_no_end(self) -> None:
        s = Session(id="s", name="n")
        assert s.is_active is True

    def test_is_active_ended(self) -> None:
        s = Session(id="s", name="n", end_time=datetime.now())
        assert s.is_active is False

    def test_duration_active(self) -> None:
        s = Session(id="s", name="n")
        d = s.duration
        assert d is not None
        assert isinstance(d, timedelta)

    def test_duration_ended(self) -> None:
        start = datetime(2025, 1, 1, 12, 0, 0)
        end = datetime(2025, 1, 1, 13, 30, 0)
        s = Session(id="s", name="n", start_time=start, end_time=end)
        assert s.duration == timedelta(hours=1, minutes=30)


# ---------------------------------------------------------------------------
# EpisodicMemory
# ---------------------------------------------------------------------------

class TestEpisodicMemoryInit:
    def test_creates_dir(self, tmp_path: Path) -> None:
        storage = tmp_path / "ep"
        mem = EpisodicMemory(storage_path=str(storage), max_episodes=100)
        assert storage.is_dir()
        assert mem.max_episodes == 100

    def test_empty_state(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        assert mem._episodes == {}
        assert mem._sessions == {}
        assert mem._current_session is None


class TestEpisodicMemoryRecord:
    def test_record_basic(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        ep = mem.record("hello world")
        assert ep.description == "hello world"
        assert ep.event_type == EventType.CUSTOM
        assert ep.id in mem._episodes

    def test_record_with_all_params(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        ep = mem.record(
            "task done",
            event_type=EventType.TASK_COMPLETE,
            context={"k": "v"},
            participants=["user"],
            outcome="success",
            success=True,
            importance=0.9,
            tags=["tag1"],
            metadata={"m": 1},
        )
        assert ep.event_type == EventType.TASK_COMPLETE
        assert ep.context == {"k": "v"}
        assert ep.participants == ["user"]
        assert ep.success is True
        assert ep.tags == ["tag1"]

    def test_record_links_preceding(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        ep1 = mem.record("first")
        ep2 = mem.record("second")
        assert ep2.preceding_event_id == ep1.id
        assert mem._episodes[ep1.id].following_event_id == ep2.id

    def test_record_adds_to_session(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        sess = mem.start_session("s1")
        ep = mem.record("in session")
        assert ep.id in sess.episode_ids

    def test_record_triggers_cleanup(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path), max_episodes=3)
        for i in range(5):
            mem.record(f"event {i}", importance=0.1 * i)
        assert len(mem._episodes) <= 3


class TestEpisodicMemoryRecall:
    @pytest.fixture()
    def mem(self, tmp_path: Path) -> EpisodicMemory:
        m = EpisodicMemory(storage_path=str(tmp_path))
        m.record("alpha", event_type=EventType.TASK_START, participants=["user"])
        m.record("beta", event_type=EventType.TASK_COMPLETE, participants=["bot"])
        m.record("gamma", event_type=EventType.TASK_START, participants=["user"])
        return m

    def test_recall_recent(self, mem: EpisodicMemory) -> None:
        recent = mem.recall_recent(2)
        assert len(recent) == 2
        assert recent[0].description == "gamma"

    def test_recall_by_type(self, mem: EpisodicMemory) -> None:
        starts = mem.recall_by_type(EventType.TASK_START)
        assert len(starts) == 2
        assert all(e.event_type == EventType.TASK_START for e in starts)

    def test_recall_by_participant(self, mem: EpisodicMemory) -> None:
        user_eps = mem.recall_by_participant("bot")
        assert len(user_eps) == 1
        assert user_eps[0].description == "beta"

    def test_recall_by_timerange(self, mem: EpisodicMemory) -> None:
        start = datetime.now() - timedelta(seconds=10)
        eps = mem.recall_by_timerange(start)
        assert len(eps) == 3

    def test_recall_sequence(self, mem: EpisodicMemory) -> None:
        eps = list(mem._episodes.values())
        mid_id = eps[1].id
        seq = mem.recall_sequence(mid_id, before=1, after=1)
        assert len(seq) == 3
        assert seq[1].id == mid_id

    def test_recall_sequence_not_found(self, mem: EpisodicMemory) -> None:
        assert mem.recall_sequence("nonexistent") == []


class TestEpisodicMemorySearch:
    def test_search_description(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        mem.record("fix a bug in the parser")
        mem.record("write new tests")
        mem.record("deploy to production")
        results = mem.search("bug")
        assert len(results) == 1
        assert results[0].description == "fix a bug in the parser"

    def test_search_by_tag(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        mem.record("event", tags=["python"])
        mem.record("other")
        results = mem.search("python")
        assert len(results) == 1

    def test_search_by_outcome(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        mem.record("task", outcome="success deployment")
        results = mem.search("deployment")
        assert len(results) == 1

    def test_search_no_match(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        mem.record("hello")
        assert mem.search("zzzzz") == []


class TestEpisodicMemorySessions:
    def test_start_and_end_session(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        sess = mem.start_session("s1", goals=["g1"])
        assert mem.get_current_session() is sess
        assert sess.goals == ["g1"]

        ended = mem.end_session(summary="done", outcomes=["o1"])
        assert ended is not None
        assert ended.summary == "done"
        assert mem.get_current_session() is None

    def test_end_session_no_active(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        assert mem.end_session() is None

    def test_starting_new_session_ends_old(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        s1 = mem.start_session("first")
        s2 = mem.start_session("second")
        assert not s1.is_active
        assert s2.is_active

    def test_get_session_episodes(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        sess = mem.start_session("s")
        mem.record("a")
        mem.record("b")
        eps = mem.get_session_episodes(sess.id)
        assert len(eps) == 2

    def test_get_session_episodes_not_found(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        assert mem.get_session_episodes("nope") == []


class TestEpisodicMemorySummary:
    def test_get_session_summary(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        sess = mem.start_session("demo", goals=["learn"])
        mem.record("important event", importance=0.9)
        summary = mem.get_session_summary(sess.id)
        assert "demo" in summary
        assert "important event" in summary

    def test_get_session_summary_not_found(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        assert mem.get_session_summary("nope") == "Session not found."

    def test_get_today_summary_empty(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        assert "No events" in mem.get_today_summary()

    def test_get_today_summary(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        mem.record("did stuff", event_type=EventType.TASK_COMPLETE)
        summary = mem.get_today_summary()
        assert "Activity" in summary
        assert "did stuff" in summary


class TestEpisodicMemoryPersistence:
    def test_save_and_load(self, tmp_path: Path) -> None:
        mem1 = EpisodicMemory(storage_path=str(tmp_path), max_episodes=100)
        sess = mem1.start_session("s1")
        mem1.record("remembered")
        session_id = sess.id

        # New instance loads from disk
        mem2 = EpisodicMemory(storage_path=str(tmp_path), max_episodes=100)
        assert len(mem2._episodes) == 1
        assert len(mem2._sessions) == 1
        # Current session should be restored (still active)
        assert mem2._current_session is not None
        assert mem2._current_session.id == session_id

    def test_load_nonexistent(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path / "fresh"))
        assert mem._episodes == {}


class TestEpisodicMemoryStats:
    def test_get_stats(self, tmp_path: Path) -> None:
        mem = EpisodicMemory(storage_path=str(tmp_path))
        mem.start_session("s")
        mem.record("e1", event_type=EventType.TASK_START)
        mem.record("e2", event_type=EventType.ERROR)
        stats = mem.get_stats()
        assert stats["total_episodes"] == 2
        assert stats["total_sessions"] == 1
        assert stats["current_session"] == "s"
        assert stats["by_type"]["task_start"] == 1
        assert stats["by_type"]["error"] == 1
