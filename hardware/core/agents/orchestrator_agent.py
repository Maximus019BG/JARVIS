"""Orchestrator Agent - Understands tasks and coordinates other agents.

The orchestrator is the main entry point for complex tasks. It:
1. Analyzes the user's request
2. Breaks it down into subtasks
3. Delegates to appropriate specialized agents
4. Aggregates and synthesizes results
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app_logging.logger import get_logger
from core.agents.base_agent import AgentResponse, AgentRole, BaseAgent

if TYPE_CHECKING:
    pass

logger = get_logger(__name__)


@dataclass
class TaskBreakdown:
    """Represents a broken-down task."""

    original_task: str
    subtasks: list[dict[str, Any]]
    agent_assignments: dict[str, AgentRole]


class OrchestratorAgent(BaseAgent):
    """Agent that understands tasks and coordinates other agents.

    The orchestrator analyzes complex requests, breaks them into subtasks,
    and determines which specialized agents should handle each part.
    """

    def __init__(
        self,
        model_name: str | None = None,
        temperature: float = 0.3,  # Lower temperature for more structured output
    ):
        super().__init__(model_name=model_name, temperature=temperature)
        self._registered_agents: dict[AgentRole, BaseAgent] = {}

    @property
    def role(self) -> AgentRole:
        return AgentRole.ORCHESTRATOR

    @property
    def system_prompt(self) -> str:
        return """You are JARVIS, an intelligent orchestrator agent. Your job is to:

1. UNDERSTAND: Carefully analyze what the user wants to accomplish
2. DECOMPOSE: Break complex tasks into smaller, manageable subtasks
3. DELEGATE: Assign each subtask to the most appropriate specialized agent:
   - CODER: For writing, reviewing, or modifying code
   - PLANNER: For creating step-by-step plans and strategies
   - BLUEPRINT: For designing parts, buildings, or system architectures (creates .jarvis files)
   - CRITIC: For reviewing, critiquing, and suggesting improvements

4. SYNTHESIZE: Combine results from all agents into a coherent response

When analyzing a task, respond with a structured breakdown:
- Main objective
- Required subtasks (numbered)
- Agent assignments for each subtask
- Dependencies between subtasks
- Expected output format

Be precise and methodical. Think step by step.
If a task is simple and doesn't need delegation, handle it directly.

Available agents: CODER, PLANNER, BLUEPRINT, CRITIC"""

    def register_agent(self, agent: BaseAgent) -> None:
        """Register a specialized agent for delegation.

        Args:
            agent: The agent to register.
        """
        self._registered_agents[agent.role] = agent
        logger.info(f"Registered {agent.name} with orchestrator")

    def get_agent(self, role: AgentRole) -> BaseAgent | None:
        """Get a registered agent by role.

        Args:
            role: The role of the agent to get.

        Returns:
            The agent if registered, None otherwise.
        """
        return self._registered_agents.get(role)

    async def analyze_task(self, task: str) -> TaskBreakdown:
        """Analyze a task and break it down into subtasks.

        Args:
            task: The task to analyze.

        Returns:
            TaskBreakdown with subtasks and agent assignments.
        """
        analysis_prompt = f"""Analyze this task and break it down:

TASK: {task}

Respond with:
1. Main objective (one sentence)
2. Subtasks (numbered list)
3. For each subtask, specify which agent should handle it:
   - CODER: code-related tasks
   - PLANNER: planning and strategy
   - BLUEPRINT: design and architecture
   - CRITIC: review and improvement

Format your response as:
OBJECTIVE: [objective]
SUBTASKS:
1. [subtask] -> [AGENT]
2. [subtask] -> [AGENT]
...
"""

        response = await self.process(analysis_prompt)

        # Parse the response into a TaskBreakdown
        subtasks = []
        assignments = {}

        if response.success:
            lines = response.content.split("\n")
            for line in lines:
                if "->" in line:
                    parts = line.split("->")
                    if len(parts) == 2:
                        subtask_text = parts[0].strip().lstrip("0123456789. ")
                        agent_name = parts[1].strip().upper()

                        # Map agent name to role
                        role_map = {
                            "CODER": AgentRole.CODER,
                            "PLANNER": AgentRole.PLANNER,
                            "BLUEPRINT": AgentRole.BLUEPRINT,
                            "CRITIC": AgentRole.CRITIC,
                        }

                        if agent_name in role_map:
                            subtask_id = f"subtask_{len(subtasks)}"
                            subtasks.append(
                                {
                                    "id": subtask_id,
                                    "description": subtask_text,
                                    "agent": agent_name,
                                }
                            )
                            assignments[subtask_id] = role_map[agent_name]

        return TaskBreakdown(
            original_task=task,
            subtasks=subtasks,
            agent_assignments=assignments,
        )

    async def orchestrate(
        self,
        task: str,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Orchestrate a complex task across multiple agents.

        Args:
            task: The task to accomplish.
            context: Optional context.

        Returns:
            AgentResponse with the aggregated result.
        """
        logger.info(f"[Orchestrator] Starting task: {task[:100]}...")

        # First, analyze and break down the task
        breakdown = await self.analyze_task(task)

        if not breakdown.subtasks:
            # Simple task, handle directly
            return await self.process(task, context)

        # Execute subtasks in order, collecting results
        results: dict[str, AgentResponse] = {}
        accumulated_context = context or {}

        for subtask in breakdown.subtasks:
            subtask_id = subtask["id"]
            subtask_desc = subtask["description"]
            agent_role = breakdown.agent_assignments.get(subtask_id)

            if agent_role and agent_role in self._registered_agents:
                agent = self._registered_agents[agent_role]
                logger.info(f"[Orchestrator] Delegating to {agent.name}: {subtask_desc}")

                # Include results from previous subtasks as context
                subtask_context = {
                    **accumulated_context,
                    "previous_results": {k: v.content for k, v in results.items()},
                }

                result = await agent.process(subtask_desc, subtask_context)
                results[subtask_id] = result

                # Add this result to accumulated context
                accumulated_context[f"result_{subtask_id}"] = result.content
            else:
                logger.warning(
                    f"[Orchestrator] No agent for role {agent_role}, handling directly"
                )
                result = await self.process(subtask_desc, accumulated_context)
                results[subtask_id] = result

        # Synthesize all results
        synthesis_prompt = f"""Synthesize these results into a coherent response:

Original Task: {task}

Results:
{chr(10).join(f"- {k}: {v.content[:500]}" for k, v in results.items())}

Provide a clear, unified response that addresses the original task.
"""

        final_response = await self.process(synthesis_prompt)

        return AgentResponse(
            content=final_response.content,
            agent_role=self.role,
            success=all(r.success for r in results.values()),
            metadata={
                "subtasks_completed": len(results),
                "breakdown": breakdown.subtasks,
            },
        )
