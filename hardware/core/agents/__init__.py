"""Agents package - Specialized AI agents for different tasks.

This module provides a multi-agent system with specialized agents:
- OrchestratorAgent: Understands tasks and coordinates other agents
- CoderAgent: Writes, reviews, and improves code
- PlannerAgent: Creates plans and strategies
- BlueprintAgent: Designs parts and buildings (.jarvis files)
- CriticAgent: Reviews and critiques work for improvements
- ResearchAgent: Gathers and synthesizes information
- MemoryAgent: Manages context and knowledge persistence
"""

from core.agents.base_agent import (
    AgentMessage,
    AgentResponse,
    AgentRole,
    BaseAgent,
)
from core.agents.blueprint_agent import (
    BlueprintAgent,
    BlueprintSpec,
    BlueprintType,
    Dimension,
    Material,
)
from core.agents.coder_agent import CoderAgent
from core.agents.critic_agent import (
    CriticAgent,
    CritiqueItem,
    CritiqueReport,
    CritiqueType,
    Severity,
)
from core.agents.memory_agent import (
    Memory,
    MemoryAgent,
    MemoryPriority,
    MemoryType,
)
from core.agents.orchestrator_agent import (
    OrchestratorAgent,
    Subtask,
    SubtaskStatus,
    TaskBreakdown,
)
from core.agents.planner_agent import (
    Plan,
    PlannerAgent,
    PlanStep,
    PlanType,
)
from core.agents.research_agent import (
    ResearchAgent,
    ResearchResult,
    ResearchSource,
    ResearchType,
)

__all__ = [
    # Base
    "AgentMessage",
    "AgentResponse",
    "AgentRole",
    "BaseAgent",
    # Orchestrator
    "OrchestratorAgent",
    "TaskBreakdown",
    "Subtask",
    "SubtaskStatus",
    # Coder
    "CoderAgent",
    # Planner
    "PlannerAgent",
    "Plan",
    "PlanStep",
    "PlanType",
    # Blueprint
    "BlueprintAgent",
    "BlueprintSpec",
    "BlueprintType",
    "Dimension",
    "Material",
    # Critic
    "CriticAgent",
    "CritiqueItem",
    "CritiqueReport",
    "CritiqueType",
    "Severity",
    # Research
    "ResearchAgent",
    "ResearchResult",
    "ResearchSource",
    "ResearchType",
    # Memory
    "MemoryAgent",
    "Memory",
    "MemoryType",
    "MemoryPriority",
]


def create_agent_team(model_name: str | None = None) -> OrchestratorAgent:
    """Create a complete agent team with orchestrator.

    This factory function creates all specialized agents and registers
    them with an orchestrator for coordinated task execution.

    Args:
        model_name: Ollama model to use for all agents.

    Returns:
        OrchestratorAgent with all specialized agents registered.

    Example:
        >>> team = create_agent_team("llama3.2:3b")
        >>> response = await team.orchestrate("Build a REST API for user management")
    """
    orchestrator = OrchestratorAgent(model_name=model_name)

    # Create and register specialized agents
    coder = CoderAgent(model_name=model_name)
    planner = PlannerAgent(model_name=model_name)
    blueprint = BlueprintAgent(model_name=model_name)
    critic = CriticAgent(model_name=model_name)
    researcher = ResearchAgent(model_name=model_name)
    memory = MemoryAgent(model_name=model_name)

    orchestrator.register_agent(coder)
    orchestrator.register_agent(planner)
    orchestrator.register_agent(blueprint)
    orchestrator.register_agent(critic)
    orchestrator.register_agent(researcher)
    orchestrator.register_agent(memory)

    return orchestrator
