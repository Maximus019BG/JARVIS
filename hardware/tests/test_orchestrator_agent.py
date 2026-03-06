"""Tests for OrchestratorAgent — register, execution order, dataclasses."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.agents.base_agent import AgentResponse, AgentRole, BaseAgent


# ── Simple concrete agent for registration ───────────────────────────


class _FakeAgent(BaseAgent):
    def __init__(self, r: AgentRole):
        cfg = MagicMock()
        cfg.conversation_max_messages = 50
        cfg.conversation_recent_messages = 10
        with patch("core.agents.base_agent.get_config", return_value=cfg):
            super().__init__()
        self._role = r

    @property
    def role(self):
        return self._role

    @property
    def system_prompt(self):
        return "fake"


@pytest.fixture()
def _patched_config():
    cfg = MagicMock()
    cfg.conversation_max_messages = 50
    cfg.conversation_recent_messages = 10
    with patch("core.agents.base_agent.get_config", return_value=cfg):
        yield cfg


# ── Dataclasses ──────────────────────────────────────────────────────


class TestOrchestratorDataclasses:
    def test_subtask_defaults(self) -> None:
        from core.agents.orchestrator_agent import Subtask, SubtaskStatus

        st = Subtask(id="t1", description="do x", agent_role=AgentRole.CODER)
        assert st.status == SubtaskStatus.PENDING
        assert st.dependencies == []
        assert st.result is None

    def test_task_breakdown(self) -> None:
        from core.agents.orchestrator_agent import Subtask, TaskBreakdown

        tb = TaskBreakdown(
            original_task="build",
            objective="create thing",
            subtasks=[
                Subtask(id="a", description="plan", agent_role=AgentRole.PLANNER)
            ],
            execution_order=[["a"]],
        )
        assert tb.objective == "create thing"
        assert len(tb.subtasks) == 1


# ── Agent registration ───────────────────────────────────────────────


class TestAgentRegistration:
    def test_register_and_get(self, _patched_config) -> None:
        from core.agents.orchestrator_agent import OrchestratorAgent

        orch = OrchestratorAgent()
        fake = _FakeAgent(AgentRole.CODER)
        orch.register_agent(fake)
        assert orch.get_agent(AgentRole.CODER) is fake

    def test_get_nonexistent(self, _patched_config) -> None:
        from core.agents.orchestrator_agent import OrchestratorAgent

        orch = OrchestratorAgent()
        assert orch.get_agent(AgentRole.BLUEPRINT) is None

    def test_get_registered_agents(self, _patched_config) -> None:
        from core.agents.orchestrator_agent import OrchestratorAgent

        orch = OrchestratorAgent()
        orch.register_agent(_FakeAgent(AgentRole.CODER))
        orch.register_agent(_FakeAgent(AgentRole.PLANNER))
        registered = orch.get_registered_agents()
        assert "Coder Agent" in registered
        assert "Planner Agent" in registered


# ── Execution order calculation ──────────────────────────────────────


class TestCalculateExecutionOrder:
    def _make_orch(self):
        from core.agents.orchestrator_agent import OrchestratorAgent

        cfg = MagicMock()
        cfg.conversation_max_messages = 50
        cfg.conversation_recent_messages = 10
        with patch("core.agents.base_agent.get_config", return_value=cfg):
            return OrchestratorAgent()

    def test_empty(self) -> None:
        assert self._make_orch()._calculate_execution_order([]) == []

    def test_no_deps(self) -> None:
        from core.agents.orchestrator_agent import Subtask

        order = self._make_orch()._calculate_execution_order([
            Subtask(id="a", description="x", agent_role=AgentRole.CODER),
            Subtask(id="b", description="y", agent_role=AgentRole.PLANNER),
        ])
        # All in one group since no deps
        assert len(order) == 1
        assert set(order[0]) == {"a", "b"}

    def test_sequential_deps(self) -> None:
        from core.agents.orchestrator_agent import Subtask

        order = self._make_orch()._calculate_execution_order([
            Subtask(id="a", description="x", agent_role=AgentRole.CODER),
            Subtask(id="b", description="y", agent_role=AgentRole.PLANNER, dependencies=["a"]),
        ])
        assert len(order) == 2
        assert order[0] == ["a"]
        assert order[1] == ["b"]

    def test_diamond_deps(self) -> None:
        """A → (B, C) → D."""
        from core.agents.orchestrator_agent import Subtask

        order = self._make_orch()._calculate_execution_order([
            Subtask(id="a", description="", agent_role=AgentRole.CODER),
            Subtask(id="b", description="", agent_role=AgentRole.PLANNER, dependencies=["a"]),
            Subtask(id="c", description="", agent_role=AgentRole.CRITIC, dependencies=["a"]),
            Subtask(id="d", description="", agent_role=AgentRole.CODER, dependencies=["b", "c"]),
        ])
        assert order[0] == ["a"]
        assert set(order[1]) == {"b", "c"}
        assert order[2] == ["d"]

    def test_circular_deps_forced(self) -> None:
        """Circular dependency should be force-resolved."""
        from core.agents.orchestrator_agent import Subtask

        order = self._make_orch()._calculate_execution_order([
            Subtask(id="x", description="", agent_role=AgentRole.CODER, dependencies=["y"]),
            Subtask(id="y", description="", agent_role=AgentRole.CODER, dependencies=["x"]),
        ])
        # All forced into a single group
        assert len(order) == 1
        assert set(order[0]) == {"x", "y"}


# ── Properties ───────────────────────────────────────────────────────


class TestOrchestratorProperties:
    def test_role(self, _patched_config) -> None:
        from core.agents.orchestrator_agent import OrchestratorAgent

        assert OrchestratorAgent().role == AgentRole.ORCHESTRATOR

    def test_system_prompt(self, _patched_config) -> None:
        from core.agents.orchestrator_agent import OrchestratorAgent

        assert "AVAILABLE AGENTS" in OrchestratorAgent().system_prompt
