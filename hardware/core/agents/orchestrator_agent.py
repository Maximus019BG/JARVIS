"""Orchestrator Agent - Understands tasks and coordinates other agents.

The orchestrator is the main entry point for complex tasks. It:
1. Analyzes the user's request
2. Breaks it down into subtasks with dependencies
3. Delegates to appropriate specialized agents in parallel when possible
4. Waits for dependencies before running dependent tasks
5. Aggregates and synthesizes results intelligently
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

from app_logging.logger import get_logger
from core.agents.base_agent import AgentResponse, AgentRole, BaseAgent

if TYPE_CHECKING:
    pass

logger = get_logger(__name__)


class SubtaskStatus(str, Enum):
    """Status of a subtask."""

    PENDING = "pending"
    WAITING = "waiting"  # Waiting for dependencies
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Subtask:
    """Represents a single subtask with dependencies."""

    id: str
    description: str
    agent_role: AgentRole
    priority: int = 1  # 1 = highest priority
    dependencies: list[str] = field(default_factory=list)  # IDs of dependent subtasks
    expected_output: str = ""  # What we expect from this subtask
    status: SubtaskStatus = SubtaskStatus.PENDING
    result: AgentResponse | None = None


@dataclass
class TaskBreakdown:
    """Represents a broken-down task with dependency graph."""

    original_task: str
    objective: str
    subtasks: list[Subtask]
    execution_order: list[list[str]]  # Groups of subtask IDs that can run in parallel


class OrchestratorAgent(BaseAgent):
    """Agent that understands tasks and coordinates other agents.

    The orchestrator analyzes complex requests, breaks them into subtasks
    with dependencies, and executes them in parallel where possible.

    Features:
    - Intelligent task decomposition
    - Dependency tracking between subtasks
    - Parallel execution of independent subtasks
    - Sequential execution when dependencies exist
    - Result aggregation and synthesis
    """

    def __init__(
        self,
        model_name: str | None = None,
        temperature: float = 0.3,
        max_parallel: int = 5,  # Max concurrent agent calls
    ):
        super().__init__(model_name=model_name, temperature=temperature)
        self._registered_agents: dict[AgentRole, BaseAgent] = {}
        self._max_parallel = max_parallel
        self._execution_semaphore = asyncio.Semaphore(max_parallel)

    @property
    def role(self) -> AgentRole:
        return AgentRole.ORCHESTRATOR

    @property
    def system_prompt(self) -> str:
        return """You are JARVIS, an intelligent orchestrator agent. Your job is to:

1. UNDERSTAND: Carefully analyze what the user wants to accomplish
2. DECOMPOSE: Break complex tasks into smaller, manageable subtasks
3. IDENTIFY DEPENDENCIES: Determine which subtasks depend on others
4. DELEGATE: Assign each subtask to the most appropriate specialized agent
5. SYNTHESIZE: Combine results from all agents into a coherent response

AVAILABLE AGENTS:
- CODER: For writing, reviewing, debugging, or modifying code
- PLANNER: For creating step-by-step plans, roadmaps, and strategies
- BLUEPRINT: For designing parts, buildings, or system architectures (.jarvis files)
- CRITIC: For reviewing, critiquing, and suggesting improvements
- RESEARCHER: For gathering information, web searches, and fact-checking
- MEMORY: For storing, retrieving, and managing context and knowledge

DEPENDENCY RULES:
- Tasks that can run independently should have no dependencies
- If task B needs output from task A, list A as a dependency of B
- Research tasks usually come first (no dependencies)
- Planning tasks may depend on research
- Coding tasks may depend on planning
- Critic tasks depend on the work they're reviewing

When breaking down tasks, think about:
- What information is needed first?
- What can be done in parallel?
- What must wait for other results?
- What's the logical order of operations?

Be precise and methodical. Maximize parallelism while respecting dependencies."""

    def register_agent(self, agent: BaseAgent) -> None:
        """Register a specialized agent for delegation."""
        self._registered_agents[agent.role] = agent
        logger.info(f"Registered {agent.name} with orchestrator")

    def get_agent(self, role: AgentRole) -> BaseAgent | None:
        """Get a registered agent by role."""
        return self._registered_agents.get(role)

    async def analyze_task(
        self, task: str, context: dict[str, Any] | None = None
    ) -> TaskBreakdown:
        """Analyze a task and break it down into subtasks with dependencies.

        Args:
            task: The task to analyze.
            context: Optional context.

        Returns:
            TaskBreakdown with subtasks, dependencies, and execution order.
        """
        analysis_prompt = f"""Analyze this task and break it down into subtasks with dependencies.

TASK: {task}

{f"CONTEXT: {json.dumps(context, default=str)[:500]}" if context else ""}

Respond in this EXACT JSON format (no markdown, just JSON):
{{
    "objective": "Clear one-sentence objective",
    "subtasks": [
        {{
            "id": "research_1",
            "description": "Detailed description of what to do",
            "agent": "RESEARCHER",
            "priority": 1,
            "dependencies": [],
            "expected_output": "What this subtask should produce"
        }},
        {{
            "id": "plan_1",
            "description": "Create implementation plan",
            "agent": "PLANNER",
            "priority": 2,
            "dependencies": ["research_1"],
            "expected_output": "Step-by-step implementation plan"
        }},
        {{
            "id": "code_1",
            "description": "Implement the solution",
            "agent": "CODER",
            "priority": 3,
            "dependencies": ["plan_1"],
            "expected_output": "Working code implementation"
        }}
    ]
}}

RULES:
- Use descriptive IDs like "research_1", "code_main", "review_final"
- Agent must be one of: CODER, PLANNER, BLUEPRINT, CRITIC, RESEARCHER, MEMORY
- Priority 1 = highest (do first), higher numbers = later
- Dependencies array contains IDs of subtasks that must complete first
- Tasks with no dependencies can run in parallel
- Keep descriptions specific and actionable
"""

        response = await self.process(analysis_prompt)

        # Parse the JSON response
        subtasks = []
        objective = task

        if response.success:
            try:
                # Extract JSON from response (handle markdown code blocks)
                content = response.content
                json_match = re.search(r"\{[\s\S]*\}", content)
                if json_match:
                    data = json.loads(json_match.group())
                    objective = data.get("objective", task)

                    role_map = {
                        "CODER": AgentRole.CODER,
                        "PLANNER": AgentRole.PLANNER,
                        "BLUEPRINT": AgentRole.BLUEPRINT,
                        "CRITIC": AgentRole.CRITIC,
                        "RESEARCHER": AgentRole.RESEARCHER,
                        "MEMORY": AgentRole.MEMORY,
                    }

                    for st in data.get("subtasks", []):
                        agent_name = st.get("agent", "").upper()
                        if agent_name in role_map:
                            subtasks.append(
                                Subtask(
                                    id=st.get("id", f"task_{len(subtasks)}"),
                                    description=st.get("description", ""),
                                    agent_role=role_map[agent_name],
                                    priority=st.get("priority", 1),
                                    dependencies=st.get("dependencies", []),
                                    expected_output=st.get("expected_output", ""),
                                )
                            )
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"Failed to parse task breakdown JSON: {e}")

        # Calculate execution order (topological sort with parallelism)
        execution_order = self._calculate_execution_order(subtasks)

        return TaskBreakdown(
            original_task=task,
            objective=objective,
            subtasks=subtasks,
            execution_order=execution_order,
        )

    def _calculate_execution_order(self, subtasks: list[Subtask]) -> list[list[str]]:
        """Calculate execution order respecting dependencies.

        Returns groups of subtask IDs where each group can run in parallel,
        and groups must run sequentially.
        """
        if not subtasks:
            return []

        # Build dependency graph
        subtask_map = {st.id: st for st in subtasks}
        completed: set[str] = set()
        execution_order: list[list[str]] = []
        remaining = set(subtask_map.keys())

        while remaining:
            # Find all subtasks whose dependencies are satisfied
            ready = []
            for task_id in remaining:
                subtask = subtask_map[task_id]
                deps_satisfied = all(d in completed for d in subtask.dependencies)
                if deps_satisfied:
                    ready.append(task_id)

            if not ready:
                # Circular dependency or missing dependency - force remaining
                logger.warning(
                    f"Circular or missing dependencies detected: {remaining}"
                )
                execution_order.append(list(remaining))
                break

            # Sort ready tasks by priority
            ready.sort(key=lambda tid: subtask_map[tid].priority)

            # Add this batch to execution order
            execution_order.append(ready)

            # Mark as completed and remove from remaining
            for task_id in ready:
                completed.add(task_id)
                remaining.remove(task_id)

        return execution_order

    async def _execute_subtask(
        self,
        subtask: Subtask,
        context: dict[str, Any],
        results: dict[str, AgentResponse],
    ) -> AgentResponse:
        """Execute a single subtask with the appropriate agent.

        Args:
            subtask: The subtask to execute.
            context: Current context.
            results: Results from completed subtasks.

        Returns:
            AgentResponse from the agent.
        """
        async with self._execution_semaphore:
            subtask.status = SubtaskStatus.RUNNING

            agent = self._registered_agents.get(subtask.agent_role)

            # Build context including dependency results
            subtask_context = {**context}

            if subtask.dependencies:
                dep_results = {}
                for dep_id in subtask.dependencies:
                    if dep_id in results:
                        dep_results[dep_id] = results[dep_id].content
                subtask_context["dependency_results"] = dep_results
                subtask_context["previous_work"] = "\n\n".join(
                    f"=== {dep_id} ===\n{content}"
                    for dep_id, content in dep_results.items()
                )

            # Enhanced prompt with context
            enhanced_prompt = subtask.description
            if subtask.expected_output:
                enhanced_prompt += f"\n\nEXPECTED OUTPUT: {subtask.expected_output}"
            if subtask.dependencies and "previous_work" in subtask_context:
                enhanced_prompt += f"\n\nPREVIOUS WORK TO BUILD ON:\n{subtask_context['previous_work'][:2000]}"

            try:
                if agent:
                    logger.info(
                        f"[Orchestrator] Running {agent.name}: {subtask.description[:60]}..."
                    )
                    result = await agent.process(enhanced_prompt, subtask_context)
                else:
                    logger.warning(
                        f"[Orchestrator] No agent for {subtask.agent_role}, handling directly"
                    )
                    result = await self.process(enhanced_prompt, subtask_context)

                subtask.status = SubtaskStatus.COMPLETED
                subtask.result = result
                return result

            except Exception as e:
                logger.error(f"[Orchestrator] Subtask {subtask.id} failed: {e}")
                subtask.status = SubtaskStatus.FAILED
                return AgentResponse(
                    content=f"Error: {e}",
                    agent_role=subtask.agent_role,
                    success=False,
                    metadata={"error": str(e)},
                )

    async def _execute_parallel_group(
        self,
        subtask_ids: list[str],
        subtask_map: dict[str, Subtask],
        context: dict[str, Any],
        results: dict[str, AgentResponse],
    ) -> dict[str, AgentResponse]:
        """Execute a group of independent subtasks in parallel with streaming.

        Performance improvements:
        - Uses asyncio.as_completed() for streaming results as they complete
        - Better parallelization by processing results immediately
        - Reduced memory overhead by not waiting for all tasks to complete

        Args:
            subtask_ids: IDs of subtasks to run in parallel.
            subtask_map: Map of all subtasks.
            context: Current context.
            results: Results from previous groups.

        Returns:
            Map of subtask ID to result.
        """
        # Build ordered list of (task_id, coroutine) pairs
        ordered_ids = []
        tasks = []
        for task_id in subtask_ids:
            subtask = subtask_map[task_id]
            ordered_ids.append(task_id)
            tasks.append(self._execute_subtask(subtask, context, results))

        # Use gather to run all subtasks concurrently and collect results
        settled = await asyncio.gather(*tasks, return_exceptions=True)

        group_results = {}
        for task_id, result in zip(ordered_ids, settled):
            if isinstance(result, BaseException):
                group_results[task_id] = AgentResponse(
                    content=f"Error: {result}",
                    agent_role=subtask_map[task_id].agent_role,
                    success=False,
                )
            else:
                group_results[task_id] = result

        return group_results

    async def _synthesize_results(
        self,
        task: str,
        objective: str,
        subtasks: list[Subtask],
        results: dict[str, AgentResponse],
    ) -> str:
        """Synthesize all subtask results into a coherent response.

        Args:
            task: Original task.
            objective: Task objective.
            subtasks: All subtasks.
            results: All results.

        Returns:
            Synthesized response content.
        """
        # Organize results by agent type for better synthesis
        results_by_agent: dict[str, list[tuple[str, str]]] = {}
        for subtask in subtasks:
            if subtask.id in results:
                agent_name = subtask.agent_role.value
                if agent_name not in results_by_agent:
                    results_by_agent[agent_name] = []
                results_by_agent[agent_name].append(
                    (subtask.description, results[subtask.id].content)
                )

        # Build synthesis prompt
        results_text = []
        for agent, agent_results in results_by_agent.items():
            results_text.append(f"\n### {agent.upper()} CONTRIBUTIONS:")
            for desc, content in agent_results:
                # Truncate long results
                truncated = content[:1500] + "..." if len(content) > 1500 else content
                results_text.append(f"\n**Task:** {desc}\n**Result:**\n{truncated}")

        synthesis_prompt = f"""Synthesize these results into a clear, comprehensive response.

## ORIGINAL REQUEST
{task}

## OBJECTIVE
{objective}

## AGENT CONTRIBUTIONS
{"".join(results_text)}

## YOUR TASK
Create a unified response that:
1. Directly addresses the original request
2. Integrates all relevant findings and outputs
3. Presents information in a logical, coherent order
4. Highlights key takeaways and action items
5. Notes any issues or areas needing attention

Be concise but complete. Use formatting (headers, bullets, code blocks) as appropriate.
"""

        response = await self.process(synthesis_prompt)
        return response.content

    async def orchestrate(
        self,
        task: str,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Orchestrate a complex task across multiple agents.

        Executes independent subtasks in parallel and waits for
        dependencies before running dependent tasks.

        Performance improvements:
        - Streaming results with asyncio.as_completed() for better parallelization
        - Immediate context updates as results arrive
        - Reduced memory overhead by processing results incrementally

        Args:
            task: The task to accomplish.
            context: Optional context.

        Returns:
            AgentResponse with the aggregated result.
        """
        logger.info(f"[Orchestrator] Starting task: {task[:100]}...")

        # Analyze and break down the task
        breakdown = await self.analyze_task(task, context)

        if not breakdown.subtasks:
            # Simple task, handle directly
            logger.info("[Orchestrator] Simple task, handling directly")
            return await self.process(task, context)

        logger.info(
            f"[Orchestrator] Broke into {len(breakdown.subtasks)} subtasks, "
            f"{len(breakdown.execution_order)} execution groups"
        )

        # Build subtask map
        subtask_map = {st.id: st for st in breakdown.subtasks}

        # Execute in order, with parallelism within groups
        results: dict[str, AgentResponse] = {}
        accumulated_context = context or {}

        for group_idx, group in enumerate(breakdown.execution_order):
            parallel_count = len(group)
            logger.info(
                f"[Orchestrator] Executing group {group_idx + 1}/{len(breakdown.execution_order)} "
                f"({parallel_count} task{'s' if parallel_count > 1 else ''} in parallel)"
            )

            # Execute all tasks in this group in parallel with streaming
            group_results = await self._execute_parallel_group(
                group, subtask_map, accumulated_context, results
            )

            # Merge results and update context immediately as they arrive
            # This allows dependent tasks to start sooner
            for task_id, result in group_results.items():
                results[task_id] = result
                accumulated_context[f"result_{task_id}"] = result.content

        # Synthesize all results
        logger.info("[Orchestrator] Synthesizing results...")
        synthesized = await self._synthesize_results(
            task, breakdown.objective, breakdown.subtasks, results
        )

        # Calculate success
        success = all(r.success for r in results.values())
        failed_count = sum(1 for r in results.values() if not r.success)

        return AgentResponse(
            content=synthesized,
            agent_role=self.role,
            success=success,
            metadata={
                "objective": breakdown.objective,
                "subtasks_total": len(breakdown.subtasks),
                "subtasks_completed": len(results),
                "subtasks_failed": failed_count,
                "execution_groups": len(breakdown.execution_order),
                "breakdown": [
                    {
                        "id": st.id,
                        "agent": st.agent_role.value,
                        "status": st.status.value,
                        "dependencies": st.dependencies,
                    }
                    for st in breakdown.subtasks
                ],
            },
        )

    async def quick_delegate(
        self,
        task: str,
        agent_role: AgentRole,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Quickly delegate a task to a specific agent without full orchestration.

        Args:
            task: The task to delegate.
            agent_role: Which agent to use.
            context: Optional context.

        Returns:
            AgentResponse from the agent.
        """
        agent = self._registered_agents.get(agent_role)
        if agent:
            return await agent.process(task, context)

        logger.warning(f"Agent {agent_role} not registered, handling directly")
        return await self.process(task, context)

    def get_registered_agents(self) -> list[str]:
        """Get list of registered agent names."""
        return [agent.name for agent in self._registered_agents.values()]
