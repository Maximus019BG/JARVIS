"""Planner Agent - Creates plans and strategies.

The planner agent specializes in:
- Breaking down complex goals into actionable steps
- Creating project roadmaps
- Developing strategies and timelines
- Resource planning
- Risk assessment
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app_logging.logger import get_logger
from core.agents.base_agent import AgentResponse, AgentRole, BaseAgent

logger = get_logger(__name__)


class PlanType(str, Enum):
    """Types of plans the agent can create."""

    PROJECT = "project"
    FEATURE = "feature"
    SPRINT = "sprint"
    ARCHITECTURE = "architecture"
    MIGRATION = "migration"
    LEARNING = "learning"


@dataclass
class PlanStep:
    """A single step in a plan."""

    id: int
    title: str
    description: str
    duration_estimate: str = ""
    dependencies: list[int] = field(default_factory=list)
    priority: str = "medium"  # low, medium, high, critical


@dataclass
class Plan:
    """A complete plan with steps and metadata."""

    title: str
    objective: str
    plan_type: PlanType
    steps: list[PlanStep]
    total_duration: str = ""
    risks: list[str] = field(default_factory=list)
    success_criteria: list[str] = field(default_factory=list)


class PlannerAgent(BaseAgent):
    """Agent specialized in creating plans and strategies.

    Excels at breaking down complex goals into actionable,
    well-organized steps with clear dependencies and timelines.
    """

    def __init__(
        self,
        model_name: str | None = None,
        temperature: float = 0.5,
    ):
        super().__init__(model_name=model_name, temperature=temperature)

    @property
    def role(self) -> AgentRole:
        return AgentRole.PLANNER

    @property
    def system_prompt(self) -> str:
        return """You are an expert project planner and strategist. Your responsibilities:

1. ANALYZE: Understand goals, constraints, and requirements
2. DECOMPOSE: Break complex objectives into manageable tasks
3. SEQUENCE: Order tasks logically with clear dependencies
4. ESTIMATE: Provide realistic time and resource estimates
5. ANTICIPATE: Identify risks and mitigation strategies

PLANNING PRINCIPLES:
- Start with the end goal and work backwards
- Each step should be concrete and actionable
- Include clear success criteria for each step
- Consider dependencies between tasks
- Build in buffer time for unknowns
- Identify critical path items
- Plan for failure scenarios

OUTPUT FORMAT for plans:
```
## Plan: [Title]

### Objective
[Clear statement of what success looks like]

### Steps
1. **[Step Title]** (Est: [time])
   - Description: [what needs to be done]
   - Dependencies: [previous steps needed]
   - Deliverable: [concrete output]

### Timeline
[Visual or textual timeline]

### Risks
- [Risk 1]: [Mitigation]

### Success Criteria
- [ ] [Criterion 1]
```

Be thorough but practical. Focus on actionable, measurable outcomes."""

    async def create_plan(
        self,
        goal: str,
        plan_type: PlanType = PlanType.PROJECT,
        constraints: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Create a comprehensive plan for achieving a goal.

        Args:
            goal: The objective to plan for.
            plan_type: Type of plan to create.
            constraints: Any constraints (time, budget, resources).
            context: Additional context.

        Returns:
            AgentResponse with the plan.
        """
        prompt = f"""Create a {plan_type.value} plan for:

GOAL: {goal}
"""

        if constraints:
            constraint_str = "\n".join(f"- {k}: {v}" for k, v in constraints.items())
            prompt += f"\n\nCONSTRAINTS:\n{constraint_str}"

        prompt += """

Provide a detailed plan with:
1. Clear objective statement
2. Numbered steps with time estimates
3. Dependencies between steps
4. Risk assessment
5. Success criteria checklist
"""

        return await self.process(prompt, context)

    async def create_roadmap(
        self,
        vision: str,
        timeframe: str = "6 months",
        milestones: int = 4,
    ) -> AgentResponse:
        """Create a high-level roadmap.

        Args:
            vision: The long-term vision or goal.
            timeframe: Total timeframe for the roadmap.
            milestones: Number of major milestones to include.

        Returns:
            AgentResponse with the roadmap.
        """
        prompt = f"""Create a roadmap for:

VISION: {vision}
TIMEFRAME: {timeframe}
MILESTONES: {milestones}

Structure the roadmap with:
1. {milestones} major milestones spread across {timeframe}
2. Key deliverables for each milestone
3. Dependencies between milestones
4. Go/no-go criteria for each phase
5. Resource requirements per phase

Format as a clear timeline with milestone markers."""

        return await self.process(prompt)

    async def estimate_effort(
        self,
        task_description: str,
        complexity_factors: list[str] | None = None,
    ) -> AgentResponse:
        """Estimate effort for a task.

        Args:
            task_description: Description of the task.
            complexity_factors: Known complexity factors.

        Returns:
            AgentResponse with effort estimate.
        """
        prompt = f"""Estimate the effort required for:

TASK: {task_description}
"""

        if complexity_factors:
            prompt += f"\n\nKNOWN COMPLEXITY FACTORS:\n" + "\n".join(
                f"- {f}" for f in complexity_factors
            )

        prompt += """

Provide:
1. Effort estimate (optimistic, realistic, pessimistic)
2. Key assumptions made
3. Factors that could increase effort
4. Factors that could decrease effort
5. Recommended buffer percentage
6. Confidence level (low/medium/high)"""

        return await self.process(prompt)

    async def identify_risks(
        self,
        plan_description: str,
    ) -> AgentResponse:
        """Identify risks in a plan.

        Args:
            plan_description: The plan to analyze.

        Returns:
            AgentResponse with risk assessment.
        """
        prompt = f"""Analyze this plan for risks:

{plan_description}

For each risk identified, provide:
1. Risk description
2. Likelihood (low/medium/high)
3. Impact (low/medium/high)
4. Mitigation strategy
5. Contingency plan
6. Early warning signs

Prioritize risks by (likelihood × impact) score."""

        return await self.process(prompt)

    async def create_sprint_plan(
        self,
        backlog_items: list[str],
        sprint_duration: str = "2 weeks",
        team_capacity: str = "40 hours",
    ) -> AgentResponse:
        """Create an agile sprint plan.

        Args:
            backlog_items: Items to consider for the sprint.
            sprint_duration: Length of the sprint.
            team_capacity: Available team capacity.

        Returns:
            AgentResponse with sprint plan.
        """
        items_str = "\n".join(f"- {item}" for item in backlog_items)

        prompt = f"""Create a sprint plan:

SPRINT DURATION: {sprint_duration}
TEAM CAPACITY: {team_capacity}

BACKLOG ITEMS:
{items_str}

Provide:
1. Sprint goal (one sentence)
2. Selected items with story point estimates
3. Capacity allocation
4. Daily breakdown of work
5. Sprint risks
6. Definition of done for each item
7. Items deferred to next sprint (if any)"""

        return await self.process(prompt)
