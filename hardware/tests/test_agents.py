"""Tests for BaseAgent and AgentRole / AgentMessage / AgentResponse."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.agents.base_agent import (
    AgentMessage,
    AgentResponse,
    AgentRole,
    BaseAgent,
)


# ── Concrete subclass for testing ────────────────────────────────────


class _TestAgent(BaseAgent):
    @property
    def role(self) -> AgentRole:
        return AgentRole.CODER

    @property
    def system_prompt(self) -> str:
        return "You are a test agent."


@pytest.fixture()
def _patched_config():
    cfg = MagicMock()
    cfg.conversation_max_messages = 50
    cfg.conversation_recent_messages = 10
    with patch("core.agents.base_agent.get_config", return_value=cfg):
        yield cfg


# ── Dataclass tests ──────────────────────────────────────────────────


class TestAgentDataclasses:
    def test_agent_message(self) -> None:
        m = AgentMessage(role="user", content="hi")
        assert m.role == "user"
        assert m.metadata == {}

    def test_agent_response_defaults(self) -> None:
        r = AgentResponse(content="ok", agent_role=AgentRole.CODER)
        assert r.success
        assert r.error is None

    def test_agent_response_error(self) -> None:
        r = AgentResponse(content="", agent_role=AgentRole.CODER, success=False, error="fail")
        assert not r.success

    def test_agent_roles(self) -> None:
        assert AgentRole.ORCHESTRATOR.value == "orchestrator"
        assert AgentRole.BLUEPRINT.value == "blueprint"
        assert AgentRole.MEMORY.value == "memory"


# ── BaseAgent construction ──────────────────────────────────────────


class TestBaseAgentInit:
    def test_defaults(self, _patched_config) -> None:
        agent = _TestAgent()
        assert agent.temperature == 0.7
        assert agent.model_name is None

    def test_custom_params(self, _patched_config) -> None:
        agent = _TestAgent(model_name="llama3", temperature=0.2)
        assert agent.model_name == "llama3"
        assert agent.temperature == 0.2

    def test_name(self, _patched_config) -> None:
        assert _TestAgent().name == "Coder Agent"


# ── History management ───────────────────────────────────────────────


class TestBaseAgentHistory:
    def test_clear_history(self, _patched_config) -> None:
        agent = _TestAgent()
        agent._conversation_history.append({"role": "user", "content": "hi"})
        agent.clear_history()
        assert agent.get_history() == []
        assert agent.get_history_size() == 0

    def test_get_history_copy(self, _patched_config) -> None:
        agent = _TestAgent()
        agent._conversation_history.append({"role": "user", "content": "hi"})
        h = agent.get_history()
        h.clear()
        assert agent.get_history_size() == 1  # original untouched

    def test_set_history_limit(self, _patched_config) -> None:
        agent = _TestAgent()
        agent.set_history_limit(20, 5)
        assert agent._max_history_size == 20
        assert agent._recent_messages_count == 5


# ── _build_messages ──────────────────────────────────────────────────


class TestBuildMessages:
    def test_no_context(self, _patched_config) -> None:
        agent = _TestAgent()
        msgs = agent._build_messages("hello")
        assert msgs[0]["role"] == "system"
        assert msgs[-1]["content"] == "hello"

    def test_with_context(self, _patched_config) -> None:
        agent = _TestAgent()
        msgs = agent._build_messages("hello", context={"plan": "do stuff"})
        # system, context, user
        assert len(msgs) == 3
        assert "plan" in msgs[1]["content"]

    def test_includes_history(self, _patched_config) -> None:
        agent = _TestAgent()
        agent._conversation_history.append({"role": "user", "content": "prev"})
        msgs = agent._build_messages("new")
        assert any(m["content"] == "prev" for m in msgs)


# ── _prune_conversation_history ──────────────────────────────────────


class TestPruneHistory:
    def test_no_prune_under_limit(self, _patched_config) -> None:
        agent = _TestAgent()
        for i in range(5):
            agent._conversation_history.append({"role": "user", "content": str(i)})
        agent._prune_conversation_history()
        assert agent.get_history_size() == 5

    def test_prunes_over_limit(self, _patched_config) -> None:
        agent = _TestAgent()
        agent.set_history_limit(10, 5)
        for i in range(15):
            agent._conversation_history.append({"role": "user", "content": str(i)})
        agent._prune_conversation_history()
        # Should have: 1 summary + 5 recent = 6
        assert agent.get_history_size() == 6
        assert agent._conversation_history[0]["role"] == "system"
        assert "Previous conversation summary" in agent._conversation_history[0]["content"]

    def test_prune_truncates_long_content(self, _patched_config) -> None:
        agent = _TestAgent()
        agent.set_history_limit(3, 2)
        agent._conversation_history = [
            {"role": "user", "content": "x" * 200},
            {"role": "assistant", "content": "short"},
            {"role": "user", "content": "a"},
            {"role": "user", "content": "b"},
        ]
        agent._prune_conversation_history()
        summary = agent._conversation_history[0]["content"]
        assert "..." in summary


# ── process ──────────────────────────────────────────────────────────


class TestProcess:
    def test_success(self, _patched_config) -> None:
        agent = _TestAgent()
        mock_llm = AsyncMock()
        mock_llm.chat_with_tools.return_value = {
            "message": {"content": "response text"}
        }
        agent._llm = mock_llm

        result = asyncio.run(agent.process("do something"))
        assert result.success
        assert result.content == "response text"
        assert result.agent_role == AgentRole.CODER
        assert agent.get_history_size() == 2  # user + assistant

    def test_error(self, _patched_config) -> None:
        agent = _TestAgent()
        mock_llm = AsyncMock()
        mock_llm.chat_with_tools.side_effect = RuntimeError("boom")
        agent._llm = mock_llm

        result = asyncio.run(agent.process("fail"))
        assert not result.success
        assert "boom" in result.error
