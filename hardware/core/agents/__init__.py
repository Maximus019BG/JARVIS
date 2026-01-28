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

from __future__ import annotations

from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
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


class LazyAgentFactory:
    """Lazy-loading factory for agent instances.

    Performance improvement: Agents are only instantiated when first accessed,
    reducing startup time and memory footprint. This is especially beneficial
    when not all agents are needed for a given task.
    """

    def __init__(self, model_name: str | None = None) -> None:
        """Initialize the lazy agent factory.

        Args:
            model_name: Ollama model to use for all agents.
        """
        self._model_name = model_name
        self._agent_factories: dict[str, Callable[[], BaseAgent]] = {}
        self._instances: dict[str, BaseAgent] = {}
        self._orchestrator: OrchestratorAgent | None = None
        self._initialized = False

    def _initialize_factories(self) -> None:
        """Initialize agent factories for lazy loading."""
        if self._initialized:
            return

        # Import agent classes lazily
        from core.agents.blueprint_agent import BlueprintAgent
        from core.agents.coder_agent import CoderAgent
        from core.agents.critic_agent import CriticAgent
        from core.agents.memory_agent import MemoryAgent
        from core.agents.orchestrator_agent import OrchestratorAgent
        from core.agents.planner_agent import PlannerAgent
        from core.agents.research_agent import ResearchAgent

        # Register factory functions
        self._agent_factories = {
            "coder": lambda: CoderAgent(model_name=self._model_name),
            "planner": lambda: PlannerAgent(model_name=self._model_name),
            "blueprint": lambda: BlueprintAgent(model_name=self._model_name),
            "critic": lambda: CriticAgent(model_name=self._model_name),
            "researcher": lambda: ResearchAgent(model_name=self._model_name),
            "memory": lambda: MemoryAgent(model_name=self._model_name),
        }

        self._initialized = True

    def get_agent(self, agent_type: str) -> BaseAgent:
        """Get an agent instance, creating it lazily if needed.

        Args:
            agent_type: Type of agent to retrieve (e.g., 'coder', 'planner').

        Returns:
            The agent instance.
        """
        self._initialize_factories()

        if agent_type not in self._instances:
            if agent_type not in self._agent_factories:
                raise ValueError(f"Unknown agent type: {agent_type}")
            self._instances[agent_type] = self._agent_factories[agent_type]()

        return self._instances[agent_type]

    def get_orchestrator(self) -> OrchestratorAgent:
        """Get the orchestrator agent with all specialized agents registered.

        Returns:
            OrchestratorAgent with all specialized agents registered.
        """
        if self._orchestrator is None:
            from core.agents.orchestrator_agent import OrchestratorAgent

            self._orchestrator = OrchestratorAgent(model_name=self._model_name)

            # Register all specialized agents
            for agent_type in [
                "coder",
                "planner",
                "blueprint",
                "critic",
                "researcher",
                "memory",
            ]:
                agent = self.get_agent(agent_type)
                self._orchestrator.register_agent(agent)

        return self._orchestrator

    def get_all_agents(self) -> dict[str, BaseAgent]:
        """Get all agent instances, creating them lazily if needed.

        Returns:
            Dictionary mapping agent types to their instances.
        """
        return {
            agent_type: self.get_agent(agent_type)
            for agent_type in [
                "coder",
                "planner",
                "blueprint",
                "critic",
                "researcher",
                "memory",
            ]
        }

    def clear_cache(self) -> None:
        """Clear cached agent instances, forcing re-creation on next access.

        Useful for testing or when agent state needs to be reset.
        """
        self._instances.clear()
        self._orchestrator = None


# Global lazy agent factory instance
_agent_factory: LazyAgentFactory | None = None


def get_agent_factory(model_name: str | None = None) -> LazyAgentFactory:
    """Get the global agent factory instance.

    Args:
        model_name: Ollama model to use for all agents.

    Returns:
        The global LazyAgentFactory instance.
    """
    global _agent_factory
    if _agent_factory is None:
        _agent_factory = LazyAgentFactory(model_name=model_name)
    return _agent_factory


def create_agent_team(model_name: str | None = None) -> OrchestratorAgent:
    """Create a complete agent team with orchestrator.

    This factory function creates all specialized agents and registers
    them with an orchestrator for coordinated task execution.

    Performance improvement: Uses lazy loading to defer agent instantiation
    until they are actually needed.

    Args:
        model_name: Ollama model to use for all agents.

    Returns:
        OrchestratorAgent with all specialized agents registered.

    Example:
        >>> team = create_agent_team("llama3.2:3b")
        >>> response = await team.orchestrate("Build a REST API for user management")
    """
    factory = get_agent_factory(model_name=model_name)
    return factory.get_orchestrator()


def get_agent(agent_type: str, model_name: str | None = None) -> BaseAgent:
    """Get a specific agent instance with lazy loading.

    Args:
        agent_type: Type of agent to retrieve (e.g., 'coder', 'planner').
        model_name: Ollama model to use for the agent.

    Returns:
        The agent instance.
    """
    factory = get_agent_factory(model_name=model_name)
    return factory.get_agent(agent_type)
