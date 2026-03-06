"""Tests for MemoryAgent sync methods and Memory dataclass."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from core.agents.base_agent import AgentRole


# ── Memory dataclass ────────────────────────────────────────────────


class TestMemoryDataclass:
    def test_roundtrip(self) -> None:
        from core.agents.memory_agent import Memory, MemoryPriority, MemoryType

        m = Memory(
            id="mem_001",
            memory_type=MemoryType.FACT,
            content="test content",
            priority=MemoryPriority.HIGH,
            tags=["t1", "t2"],
            metadata={"k": "v"},
        )
        d = m.to_dict()
        m2 = Memory.from_dict(d)
        assert m2.id == m.id
        assert m2.memory_type == MemoryType.FACT
        assert m2.priority == MemoryPriority.HIGH
        assert m2.tags == ["t1", "t2"]

    def test_from_dict_defaults(self) -> None:
        from core.agents.memory_agent import Memory, MemoryPriority, MemoryType

        m = Memory.from_dict(
            {"id": "x", "memory_type": "fact", "content": "hi"}
        )
        assert m.priority == MemoryPriority.MEDIUM
        assert m.tags == []


# ── MemoryAgent sync API ─────────────────────────────────────────────


@pytest.fixture()
def agent(tmp_path: Path):
    """Create a MemoryAgent with patched config."""
    cfg = MagicMock()
    cfg.conversation_max_messages = 50
    cfg.conversation_recent_messages = 10
    with patch("core.agents.base_agent.get_config", return_value=cfg):
        from core.agents.memory_agent import MemoryAgent
        return MemoryAgent(
            memory_file=str(tmp_path / "mem.json"),
            max_short_term=10,
        )


class TestMemoryAgentProperties:
    def test_role(self, agent) -> None:
        assert agent.role == AgentRole.MEMORY

    def test_system_prompt(self, agent) -> None:
        assert len(agent.system_prompt) > 50

    def test_is_advanced_mode(self, agent) -> None:
        assert agent.is_advanced_mode is False


class TestMemoryAgentStore:
    def test_store_medium(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        m = agent.store("hello", priority=MemoryPriority.MEDIUM)
        assert m.content == "hello"
        # medium → only in short-term
        assert m.id not in agent._long_term

    def test_store_high(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        m = agent.store("important", priority=MemoryPriority.HIGH, tags=["t"])
        assert m.id in agent._long_term

    def test_store_critical_persists(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        m = agent.store("critical", priority=MemoryPriority.CRITICAL)
        assert m.id in agent._long_term
        assert Path(agent.memory_file).exists()


class TestMemoryAgentRecall:
    def test_recall_by_content(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        agent.store("The sky is blue", priority=MemoryPriority.HIGH)
        hits = agent.recall("sky")
        assert len(hits) >= 1

    def test_recall_filter_type(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority, MemoryType

        agent.store("fact 1", memory_type=MemoryType.FACT, priority=MemoryPriority.HIGH)
        agent.store("pref 1", memory_type=MemoryType.PREFERENCE, priority=MemoryPriority.HIGH)
        hits = agent.recall("1", memory_type=MemoryType.FACT)
        assert all(h.memory_type == MemoryType.FACT for h in hits)

    def test_recall_filter_tags(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        agent.store("tagged", priority=MemoryPriority.HIGH, tags=["alpha"])
        agent.store("other", priority=MemoryPriority.HIGH, tags=["beta"])
        hits = agent.recall("tagged", tags=["alpha"])
        assert len(hits) >= 1

    def test_recall_by_tags_index(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        agent.store("x", priority=MemoryPriority.HIGH, tags=["special"])
        hits = agent.recall_by_tags(["special"])
        assert len(hits) >= 1


class TestMemoryAgentForget:
    def test_forget_existing(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        m = agent.store("forget me", priority=MemoryPriority.HIGH, tags=["t"])
        assert agent.forget(m.id)
        assert m.id not in agent._long_term

    def test_forget_nonexistent(self, agent) -> None:
        assert not agent.forget("nope")


class TestMemoryAgentContext:
    def test_get_context(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        agent.store("ctx1", priority=MemoryPriority.HIGH)
        agent.store("ctx2", priority=MemoryPriority.MEDIUM)
        ctx = agent.get_context("ctx", max_items=5)
        assert len(ctx) >= 1

    def test_get_stats(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        agent.store("s", priority=MemoryPriority.HIGH)
        stats = agent.get_stats()
        assert stats["long_term_count"] == 1
        assert stats["short_term_count"] == 1

    def test_clear_short_term(self, agent) -> None:
        agent.store("ephemeral")
        agent.clear_short_term()
        assert len(agent._short_term) == 0

    def test_clear_all(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        agent.store("gone", priority=MemoryPriority.HIGH)
        agent.clear_all()
        assert agent.get_stats()["long_term_count"] == 0

    def test_semantic_search_basic(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        agent.store("searchable thing", priority=MemoryPriority.HIGH)
        results = agent.semantic_search("searchable")
        assert len(results) >= 1
        assert results[0]["source"] == "basic"


class TestMemoryAgentPersistence:
    def test_load_on_init(self, tmp_path: Path) -> None:
        from core.agents.memory_agent import MemoryPriority

        cfg = MagicMock()
        cfg.conversation_max_messages = 50
        cfg.conversation_recent_messages = 10
        mf = str(tmp_path / "mem.json")

        with patch("core.agents.base_agent.get_config", return_value=cfg):
            from core.agents.memory_agent import MemoryAgent

            a1 = MemoryAgent(memory_file=mf, max_short_term=10)
            a1.store("persisted", priority=MemoryPriority.CRITICAL, tags=["p"])

            a2 = MemoryAgent(memory_file=mf, max_short_term=10)
            assert a2.get_stats()["long_term_count"] == 1

    def test_get_context_for_prompt(self, agent) -> None:
        from core.agents.memory_agent import MemoryPriority

        agent.store("short fact", priority=MemoryPriority.CRITICAL)
        prompt = agent.get_context_for_prompt(max_tokens=500)
        assert isinstance(prompt, str)
