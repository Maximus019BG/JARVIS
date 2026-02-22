"""Tests for concrete agent subclasses — sync helpers, dataclasses, properties."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from core.agents.base_agent import AgentRole


@pytest.fixture(autouse=True)
def _patched_config():
    cfg = MagicMock()
    cfg.conversation_max_messages = 50
    cfg.conversation_recent_messages = 10
    with patch("core.agents.base_agent.get_config", return_value=cfg):
        yield cfg


# ── BlueprintAgent ──────────────────────────────────────────────────


class TestBlueprintAgentDataclasses:
    def test_blueprint_type(self) -> None:
        from core.agents.blueprint_agent import BlueprintType
        assert BlueprintType.PART.value == "part"
        assert BlueprintType.ASSEMBLY.value == "assembly"

    def test_dimension(self) -> None:
        from core.agents.blueprint_agent import Dimension
        d = Dimension(length=10, width=5, height=3, unit="cm")
        assert d.unit == "cm"

    def test_material(self) -> None:
        from core.agents.blueprint_agent import Material
        m = Material(name="Steel", type="metal")
        assert m.properties == {}

    def test_blueprint_spec(self) -> None:
        from core.agents.blueprint_agent import BlueprintSpec, BlueprintType
        spec = BlueprintSpec(name="Test", blueprint_type=BlueprintType.PART, description="a part")
        assert spec.dimensions is None
        assert spec.materials == []


class TestBlueprintAgentFileOps:
    def test_save_and_load(self, tmp_path: Path) -> None:
        from core.agents.blueprint_agent import BlueprintAgent
        agent = BlueprintAgent(blueprint_dir=str(tmp_path))
        data = {"name": "widget", "type": "part"}
        path = agent.save_blueprint("widget", data)
        assert path.exists()
        loaded = agent.load_blueprint("widget")
        assert loaded["name"] == "widget"

    def test_save_adds_metadata(self, tmp_path: Path) -> None:
        from core.agents.blueprint_agent import BlueprintAgent
        agent = BlueprintAgent(blueprint_dir=str(tmp_path))
        data = {"name": "x"}
        agent.save_blueprint("x", data)
        loaded = agent.load_blueprint("x")
        assert "jarvis_version" in loaded
        assert "created" in loaded

    def test_load_nonexistent(self, tmp_path: Path) -> None:
        from core.agents.blueprint_agent import BlueprintAgent
        agent = BlueprintAgent(blueprint_dir=str(tmp_path))
        assert agent.load_blueprint("nope") is None

    def test_list_blueprints(self, tmp_path: Path) -> None:
        from core.agents.blueprint_agent import BlueprintAgent
        agent = BlueprintAgent(blueprint_dir=str(tmp_path))
        agent.save_blueprint("a", {"x": 1})
        agent.save_blueprint("b", {"y": 2})
        names = agent.list_blueprints()
        assert set(names) == {"a", "b"}

    def test_role_and_prompt(self) -> None:
        from core.agents.blueprint_agent import BlueprintAgent
        agent = BlueprintAgent()
        assert agent.role == AgentRole.BLUEPRINT
        assert len(agent.system_prompt) > 50


# ── CoderAgent ──────────────────────────────────────────────────────


class TestCoderAgent:
    def test_role_and_prompt(self) -> None:
        from core.agents.coder_agent import CoderAgent
        agent = CoderAgent()
        assert agent.role == AgentRole.CODER
        assert len(agent.system_prompt) > 50


# ── CriticAgent ─────────────────────────────────────────────────────


class TestCriticAgentDataclasses:
    def test_critique_type_enum(self) -> None:
        from core.agents.critic_agent import CritiqueType
        assert CritiqueType.CODE_REVIEW.value == "code_review"

    def test_severity_enum(self) -> None:
        from core.agents.critic_agent import Severity
        assert Severity.CRITICAL.value == "critical"

    def test_critique_item(self) -> None:
        from core.agents.critic_agent import CritiqueItem, Severity
        item = CritiqueItem(category="style", severity=Severity.MINOR, description="dup", suggestion="fix")
        assert item.suggestion == "fix"

    def test_critique_report(self) -> None:
        from core.agents.critic_agent import CritiqueReport
        r = CritiqueReport(summary="ok", items=[], overall_score=8)
        assert r.overall_score == 8

    def test_role(self) -> None:
        from core.agents.critic_agent import CriticAgent
        assert CriticAgent().role == AgentRole.CRITIC


# ── PlannerAgent ────────────────────────────────────────────────────


class TestPlannerAgentDataclasses:
    def test_plan_type(self) -> None:
        from core.agents.planner_agent import PlanType
        assert PlanType.PROJECT.value == "project"

    def test_plan_step(self) -> None:
        from core.agents.planner_agent import PlanStep
        s = PlanStep(id=1, title="step one", description="foo")
        assert s.dependencies == []

    def test_plan(self) -> None:
        from core.agents.planner_agent import Plan, PlanType
        p = Plan(title="Plan A", objective="obj", plan_type=PlanType.PROJECT, steps=[])
        assert p.total_duration == ""

    def test_role(self) -> None:
        from core.agents.planner_agent import PlannerAgent
        assert PlannerAgent().role == AgentRole.PLANNER


# ── ResearchAgent ───────────────────────────────────────────────────


class TestResearchAgentDataclasses:
    def test_research_type(self) -> None:
        from core.agents.research_agent import ResearchType
        assert ResearchType.FACT_CHECK.value == "fact_check"

    def test_research_source(self) -> None:
        from core.agents.research_agent import ResearchSource
        s = ResearchSource(title="wiki")
        assert s.url is None

    def test_research_result(self) -> None:
        from core.agents.research_agent import ResearchResult
        r = ResearchResult(query="q", summary="s", sources=[], confidence=0.9)
        assert r.confidence == 0.9


class TestResearchAgentKnowledgeBase:
    def test_add_get(self) -> None:
        from core.agents.research_agent import ResearchAgent
        ra = ResearchAgent()
        ra.add_to_knowledge_base("key1", "value1")
        assert ra.get_from_knowledge_base("key1") == "value1"

    def test_get_missing(self) -> None:
        from core.agents.research_agent import ResearchAgent
        assert ResearchAgent().get_from_knowledge_base("nope") is None

    def test_search(self) -> None:
        from core.agents.research_agent import ResearchAgent
        ra = ResearchAgent()
        ra.add_to_knowledge_base("python_tips", "use list comprehensions")
        ra.add_to_knowledge_base("java_tips", "use streams")
        results = ra.search_knowledge_base("python")
        assert len(results) == 1
        assert results[0][0] == "python_tips"

    def test_search_content_match(self) -> None:
        from core.agents.research_agent import ResearchAgent
        ra = ResearchAgent()
        ra.add_to_knowledge_base("misc", "Python is great")
        results = ra.search_knowledge_base("python")
        assert len(results) == 1

    def test_role_and_prompt(self) -> None:
        from core.agents.research_agent import ResearchAgent
        ra = ResearchAgent()
        assert ra.role == AgentRole.RESEARCHER
        assert len(ra.system_prompt) > 50
