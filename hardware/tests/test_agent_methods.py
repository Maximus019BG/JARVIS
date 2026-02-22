"""Tests for core.agents – coder, critic, planner, research agents."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.agents.base_agent import AgentResponse, AgentRole


# ---------------------------------------------------------------------------
# Helper to create a mock config
# ---------------------------------------------------------------------------

def _mock_config():
    cfg = MagicMock()
    cfg.conversation_max_messages = 50
    cfg.conversation_recent_messages = 10
    return cfg


# ---------------------------------------------------------------------------
# CoderAgent
# ---------------------------------------------------------------------------

class TestCoderAgent:
    def _agent(self):
        with patch("core.agents.base_agent.get_config", return_value=_mock_config()):
            from core.agents.coder_agent import CoderAgent
            return CoderAgent()

    def test_role(self):
        agent = self._agent()
        assert agent.role == AgentRole.CODER

    def test_system_prompt(self):
        agent = self._agent()
        assert "code" in agent.system_prompt.lower()

    def test_write_code(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="```python\nprint('hi')\n```", agent_role=AgentRole.CODER,
        ))
        result = asyncio.run(agent.write_code("print hello"))
        assert "python" in result.content.lower() or "print" in result.content

    def test_write_code_with_context(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="code", agent_role=AgentRole.CODER,
        ))
        result = asyncio.run(agent.write_code("add tests", context={"file": "app.py"}))
        assert result.content == "code"

    def test_review_code(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="looks good", agent_role=AgentRole.CODER,
        ))
        result = asyncio.run(agent.review_code("def f(): pass"))
        assert result.content == "looks good"

    def test_refactor_code(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="refactored", agent_role=AgentRole.CODER,
        ))
        result = asyncio.run(agent.refactor_code("x=1", "readability"))
        assert result.content == "refactored"

    def test_debug_code(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="fixed", agent_role=AgentRole.CODER,
        ))
        result = asyncio.run(agent.debug_code("x/0", "ZeroDivisionError"))
        assert result.content == "fixed"

    def test_explain_code(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="explanation", agent_role=AgentRole.CODER,
        ))
        result = asyncio.run(agent.explain_code("x=1", detail_level="brief"))
        assert result.content == "explanation"

    def test_explain_code_detailed(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="detailed", agent_role=AgentRole.CODER,
        ))
        result = asyncio.run(agent.explain_code("x=1", detail_level="detailed"))
        assert result.content == "detailed"


# ---------------------------------------------------------------------------
# CriticAgent
# ---------------------------------------------------------------------------

class TestCriticAgent:
    def _agent(self):
        with patch("core.agents.base_agent.get_config", return_value=_mock_config()):
            from core.agents.critic_agent import CriticAgent
            return CriticAgent()

    def test_role(self):
        agent = self._agent()
        assert agent.role == AgentRole.CRITIC

    def test_system_prompt(self):
        agent = self._agent()
        assert len(agent.system_prompt) > 50

    def test_critique(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="critique result", agent_role=AgentRole.CRITIC,
        ))
        result = asyncio.run(agent.critique("some work"))
        assert result.content == "critique result"

    def test_review_code(self):
        agent = self._agent()
        agent.critique = AsyncMock(return_value=AgentResponse(
            content="code review", agent_role=AgentRole.CRITIC,
        ))
        result = asyncio.run(agent.review_code("def f(): pass"))
        assert result.content == "code review"

    def test_review_plan(self):
        agent = self._agent()
        agent.critique = AsyncMock(return_value=AgentResponse(
            content="plan review", agent_role=AgentRole.CRITIC,
        ))
        result = asyncio.run(agent.review_plan("my plan", goals=["g1"]))
        assert result.content == "plan review"

    def test_review_design(self):
        agent = self._agent()
        agent.critique = AsyncMock(return_value=AgentResponse(
            content="design review", agent_role=AgentRole.CRITIC,
        ))
        result = asyncio.run(agent.review_design("design doc", requirements=["r1"]))
        assert result.content == "design review"

    def test_improve(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="improved", agent_role=AgentRole.CRITIC,
        ))
        result = asyncio.run(agent.improve("work", critique_feedback="fix this"))
        assert result.content == "improved"

    def test_find_edge_cases(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="edge cases", agent_role=AgentRole.CRITIC,
        ))
        result = asyncio.run(agent.find_edge_cases("spec"))
        assert result.content == "edge cases"

    def test_security_review(self):
        agent = self._agent()
        agent.critique = AsyncMock(return_value=AgentResponse(
            content="security", agent_role=AgentRole.CRITIC,
        ))
        result = asyncio.run(agent.security_review("code here"))
        assert result.content == "security"


# ---------------------------------------------------------------------------
# PlannerAgent
# ---------------------------------------------------------------------------

class TestPlannerAgent:
    def _agent(self):
        with patch("core.agents.base_agent.get_config", return_value=_mock_config()):
            from core.agents.planner_agent import PlannerAgent
            return PlannerAgent()

    def test_role(self):
        agent = self._agent()
        assert agent.role == AgentRole.PLANNER

    def test_create_plan(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="step1\nstep2", agent_role=AgentRole.PLANNER,
        ))
        result = asyncio.run(agent.create_plan("build app"))
        assert "step" in result.content

    def test_create_roadmap(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="roadmap", agent_role=AgentRole.PLANNER,
        ))
        result = asyncio.run(agent.create_roadmap("project", milestones=["m1"]))
        assert result.content == "roadmap"

    def test_estimate_effort(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="2 hours", agent_role=AgentRole.PLANNER,
        ))
        result = asyncio.run(agent.estimate_effort("task"))
        assert "hour" in result.content

    def test_identify_risks(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="risk: timeout", agent_role=AgentRole.PLANNER,
        ))
        result = asyncio.run(agent.identify_risks("deploy plan"))
        assert result.content == "risk: timeout"

    def test_create_sprint_plan(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="sprint plan", agent_role=AgentRole.PLANNER,
        ))
        result = asyncio.run(agent.create_sprint_plan(["task1", "task2"]))
        assert result.content == "sprint plan"


# ---------------------------------------------------------------------------
# ResearchAgent
# ---------------------------------------------------------------------------

class TestResearchAgent:
    def _agent(self):
        with patch("core.agents.base_agent.get_config", return_value=_mock_config()):
            from core.agents.research_agent import ResearchAgent
            return ResearchAgent()

    def test_role(self):
        agent = self._agent()
        assert agent.role == AgentRole.RESEARCHER

    def test_research(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="findings", agent_role=AgentRole.RESEARCHER,
        ))
        result = asyncio.run(agent.research("AI"))
        assert result.content == "findings"

    def test_research_deep(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="deep findings", agent_role=AgentRole.RESEARCHER,
        ))
        result = asyncio.run(agent.research("AI", depth="deep"))
        assert result.content == "deep findings"

    def test_compare(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="comparison", agent_role=AgentRole.RESEARCHER,
        ))
        result = asyncio.run(agent.compare(["React", "Vue"]))
        assert result.content == "comparison"

    def test_fact_check(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="verified", agent_role=AgentRole.RESEARCHER,
        ))
        result = asyncio.run(agent.fact_check(["claim1", "claim2"]))
        assert result.content == "verified"

    def test_analyze_document(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="analysis", agent_role=AgentRole.RESEARCHER,
        ))
        result = asyncio.run(agent.analyze_document("some doc text"))
        assert result.content == "analysis"

    def test_summarize(self):
        agent = self._agent()
        agent.process = AsyncMock(return_value=AgentResponse(
            content="summary", agent_role=AgentRole.RESEARCHER,
        ))
        result = asyncio.run(agent.summarize("long content here"))
        assert result.content == "summary"
