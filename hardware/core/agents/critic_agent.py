"""Critic Agent - Reviews, critiques, and improves outputs.

The critic agent specializes in:
- Reviewing work from other agents
- Providing constructive feedback
- Suggesting improvements
- Quality assurance
- Finding edge cases and issues
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app_logging.logger import get_logger
from core.agents.base_agent import AgentResponse, AgentRole, BaseAgent

logger = get_logger(__name__)


class CritiqueType(str, Enum):
    """Types of critiques that can be performed."""

    CODE_REVIEW = "code_review"
    PLAN_REVIEW = "plan_review"
    DESIGN_REVIEW = "design_review"
    GENERAL = "general"
    SECURITY = "security"
    PERFORMANCE = "performance"


class Severity(str, Enum):
    """Severity levels for issues found."""

    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    SUGGESTION = "suggestion"
    PRAISE = "praise"


@dataclass
class CritiqueItem:
    """A single critique item."""

    category: str
    severity: Severity
    description: str
    suggestion: str
    location: str = ""  # Line number, section, or component


@dataclass
class CritiqueReport:
    """Complete critique report."""

    overall_score: int  # 1-10
    summary: str
    items: list[CritiqueItem] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    improvements: list[str] = field(default_factory=list)


class CriticAgent(BaseAgent):
    """Agent specialized in reviewing and improving work.

    Acts as a quality gate, providing constructive criticism
    and specific improvement suggestions for any type of work.
    """

    def __init__(
        self,
        model_name: str | None = None,
        temperature: float = 0.4,  # More deterministic for consistent critique
    ):
        super().__init__(model_name=model_name, temperature=temperature)

    @property
    def role(self) -> AgentRole:
        return AgentRole.CRITIC

    @property
    def system_prompt(self) -> str:
        return """You are an expert critic and quality reviewer. Your responsibilities:

1. ANALYZE: Thoroughly examine the work presented
2. EVALUATE: Assess against best practices and requirements
3. IDENTIFY: Find issues, edge cases, and potential problems
4. SUGGEST: Provide specific, actionable improvements
5. PRAISE: Acknowledge what was done well

CRITIQUE PRINCIPLES:
- Be constructive, not destructive
- Provide specific examples, not vague criticism
- Suggest solutions for every problem identified
- Prioritize issues by severity (critical > major > minor)
- Balance criticism with recognition of strengths
- Consider the context and constraints
- Think about edge cases and failure modes

SEVERITY LEVELS:
- CRITICAL: Must fix, blocks functionality or has serious issues
- MAJOR: Should fix, significant improvement opportunity
- MINOR: Nice to fix, small improvements
- SUGGESTION: Optional enhancement
- PRAISE: Highlight good practices

OUTPUT FORMAT:
```
## Critique Report

### Overall Score: X/10

### Summary
[Brief overview of the work quality]

### Strengths
- ✅ [Strength 1]
- ✅ [Strength 2]

### Issues Found
1. **[SEVERITY]** [Category]: [Description]
   - Location: [Where]
   - Suggestion: [How to fix]

### Improvement Recommendations
1. [Specific actionable improvement]

### Conclusion
[Final thoughts and priority items]
```

Be thorough but fair. Your goal is to help improve, not to tear down."""

    async def critique(
        self,
        work: str,
        critique_type: CritiqueType = CritiqueType.GENERAL,
        criteria: list[str] | None = None,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Critique a piece of work.

        Args:
            work: The work to critique.
            critique_type: Type of critique to perform.
            criteria: Specific criteria to evaluate against.
            context: Additional context.

        Returns:
            AgentResponse with the critique.
        """
        prompt = f"""Perform a {critique_type.value} on the following:

---
{work}
---
"""

        if criteria:
            criteria_str = "\n".join(f"- {c}" for c in criteria)
            prompt += f"\n\nEVALUATE AGAINST THESE CRITERIA:\n{criteria_str}"

        prompt += """

Provide a comprehensive critique including:
1. Overall score (1-10)
2. Summary
3. Strengths (what was done well)
4. Issues found with severity levels
5. Specific improvement recommendations
6. Priority items to address first
"""

        return await self.process(prompt, context)

    async def review_code(
        self,
        code: str,
        language: str = "python",
        focus_areas: list[str] | None = None,
    ) -> AgentResponse:
        """Review code for quality and issues.

        Args:
            code: The code to review.
            language: Programming language.
            focus_areas: Specific areas to focus on.

        Returns:
            AgentResponse with code review.
        """
        default_focus = [
            "correctness",
            "readability",
            "maintainability",
            "security",
            "performance",
            "error handling",
        ]
        areas = focus_areas or default_focus

        prompt = f"""Review this {language} code:

```{language}
{code}
```

FOCUS AREAS:
{chr(10).join(f"- {a}" for a in areas)}

Provide:
1. Line-by-line issues (if any)
2. Security vulnerabilities
3. Performance concerns
4. Best practices violations
5. Suggested refactoring
6. Test cases that should exist
"""

        return await self.critique(prompt, CritiqueType.CODE_REVIEW)

    async def review_plan(
        self,
        plan: str,
        goals: list[str] | None = None,
    ) -> AgentResponse:
        """Review a plan for completeness and feasibility.

        Args:
            plan: The plan to review.
            goals: Goals the plan should achieve.

        Returns:
            AgentResponse with plan review.
        """
        prompt = f"""Review this plan:

{plan}
"""

        if goals:
            goals_str = "\n".join(f"- {g}" for g in goals)
            prompt += f"\n\nGOALS TO ACHIEVE:\n{goals_str}"

        prompt += """

Evaluate:
1. Completeness - are all necessary steps included?
2. Feasibility - are the estimates realistic?
3. Dependencies - are they correctly identified?
4. Risks - are they adequately addressed?
5. Success criteria - are they measurable?
6. Missing considerations
"""

        return await self.critique(prompt, CritiqueType.PLAN_REVIEW)

    async def review_design(
        self,
        design: str,
        design_type: str = "general",
        requirements: list[str] | None = None,
    ) -> AgentResponse:
        """Review a design for quality and feasibility.

        Args:
            design: The design to review.
            design_type: Type of design (blueprint, architecture, etc).
            requirements: Requirements to evaluate against.

        Returns:
            AgentResponse with design review.
        """
        prompt = f"""Review this {design_type} design:

{design}
"""

        if requirements:
            reqs_str = "\n".join(f"- {r}" for r in requirements)
            prompt += f"\n\nREQUIREMENTS:\n{reqs_str}"

        prompt += """

Evaluate:
1. Does it meet all requirements?
2. Is it manufacturable/buildable?
3. Are materials appropriate?
4. Are dimensions and tolerances reasonable?
5. Safety considerations
6. Cost optimization opportunities
7. Potential failure modes
"""

        return await self.critique(prompt, CritiqueType.DESIGN_REVIEW)

    async def improve(
        self,
        work: str,
        critique_feedback: str | None = None,
    ) -> AgentResponse:
        """Provide an improved version of the work.

        Args:
            work: The original work.
            critique_feedback: Previous critique feedback.

        Returns:
            AgentResponse with improved version.
        """
        prompt = f"""Improve this work:

ORIGINAL:
{work}
"""

        if critique_feedback:
            prompt += f"\n\nPREVIOUS FEEDBACK:\n{critique_feedback}"

        prompt += """

Provide:
1. The improved version
2. List of changes made
3. Rationale for each change
4. Any remaining concerns
"""

        return await self.process(prompt)

    async def find_edge_cases(
        self,
        specification: str,
    ) -> AgentResponse:
        """Identify edge cases and potential issues.

        Args:
            specification: The specification to analyze.

        Returns:
            AgentResponse with edge cases.
        """
        prompt = f"""Analyze this specification for edge cases:

{specification}

Identify:
1. Input edge cases (empty, null, extreme values)
2. Boundary conditions
3. Race conditions or timing issues
4. Resource exhaustion scenarios
5. Unexpected user behaviors
6. Integration edge cases
7. Failure modes

For each edge case:
- Describe the scenario
- Explain the potential impact
- Suggest how to handle it
"""

        return await self.process(prompt)

    async def security_review(
        self,
        work: str,
        work_type: str = "code",
    ) -> AgentResponse:
        """Perform a security-focused review.

        Args:
            work: The work to review.
            work_type: Type of work (code, design, plan).

        Returns:
            AgentResponse with security review.
        """
        prompt = f"""Perform a security review of this {work_type}:

{work}

Check for:
1. Injection vulnerabilities (SQL, command, etc.)
2. Authentication/authorization issues
3. Data exposure risks
4. Input validation gaps
5. Cryptography weaknesses
6. Access control issues
7. Logging and audit gaps
8. Dependency vulnerabilities

Rate each finding by severity and provide remediation steps.
"""

        return await self.critique(prompt, CritiqueType.SECURITY)
