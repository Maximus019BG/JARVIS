"""Coder Agent - Specialized in writing and reviewing code.

The coder agent handles all code-related tasks:
- Writing new code
- Reviewing existing code
- Refactoring and optimization
- Bug fixing
- Code explanation
"""

from __future__ import annotations

from typing import Any

from app_logging.logger import get_logger
from core.agents.base_agent import AgentResponse, AgentRole, BaseAgent

logger = get_logger(__name__)


class CoderAgent(BaseAgent):
    """Agent specialized in writing, reviewing, and improving code.

    Uses best practices and clean code principles to generate
    high-quality, maintainable code.
    """

    def __init__(
        self,
        model_name: str | None = None,
        temperature: float = 0.4,  # Moderate creativity for code
    ):
        super().__init__(model_name=model_name, temperature=temperature)

    @property
    def role(self) -> AgentRole:
        return AgentRole.CODER

    @property
    def system_prompt(self) -> str:
        return """You are an expert software engineer and coder. Your responsibilities:

1. WRITE CODE: Create clean, efficient, well-documented code
2. REVIEW CODE: Analyze code for bugs, security issues, and improvements
3. REFACTOR: Improve code structure while maintaining functionality
4. DEBUG: Identify and fix issues in existing code
5. EXPLAIN: Clearly explain how code works

CODING PRINCIPLES:
- Write clean, readable code with meaningful names
- Follow SOLID principles and design patterns where appropriate
- Include proper error handling and edge cases
- Add docstrings and comments for complex logic
- Prefer simplicity over cleverness
- Write testable code
- Consider performance and scalability

OUTPUT FORMAT:
- Always wrap code in appropriate markdown code blocks with language tags
- Explain your design decisions
- Note any assumptions made
- Suggest tests that should be written

SUPPORTED LANGUAGES:
Python, JavaScript, TypeScript, Rust, Go, C++, and more.
Default to Python unless specified otherwise.

When given a coding task, first understand the requirements, then implement step by step."""

    async def write_code(
        self,
        specification: str,
        language: str = "python",
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Write code based on a specification.

        Args:
            specification: What the code should do.
            language: Programming language to use.
            context: Optional context (existing code, requirements, etc).

        Returns:
            AgentResponse with the generated code.
        """
        prompt = f"""Write {language} code for the following specification:

{specification}

Requirements:
- Clean, well-documented code
- Proper error handling
- Follow {language} best practices
- Include type hints (if applicable)
"""

        if context:
            context_str = "\n".join(f"- {k}: {v}" for k, v in context.items())
            prompt += f"\n\nAdditional Context:\n{context_str}"

        return await self.process(prompt, context)

    async def review_code(
        self,
        code: str,
        language: str = "python",
    ) -> AgentResponse:
        """Review code and provide feedback.

        Args:
            code: The code to review.
            language: Programming language of the code.

        Returns:
            AgentResponse with review feedback.
        """
        prompt = f"""Review this {language} code and provide feedback:

```{language}
{code}
```

Analyze for:
1. Bugs and potential issues
2. Security vulnerabilities
3. Performance concerns
4. Code style and readability
5. Best practices compliance

Provide specific, actionable feedback with line references where applicable.
Rate the overall code quality (1-10) and suggest improvements."""

        return await self.process(prompt)

    async def refactor_code(
        self,
        code: str,
        goals: str,
        language: str = "python",
    ) -> AgentResponse:
        """Refactor code based on specific goals.

        Args:
            code: The code to refactor.
            goals: What to improve (e.g., "readability", "performance").
            language: Programming language of the code.

        Returns:
            AgentResponse with refactored code.
        """
        prompt = f"""Refactor this {language} code with the following goals:

GOALS: {goals}

ORIGINAL CODE:
```{language}
{code}
```

Provide:
1. The refactored code
2. Explanation of changes made
3. Why each change improves the code"""

        return await self.process(prompt)

    async def debug_code(
        self,
        code: str,
        error_message: str,
        language: str = "python",
    ) -> AgentResponse:
        """Debug code and fix issues.

        Args:
            code: The buggy code.
            error_message: The error or issue description.
            language: Programming language of the code.

        Returns:
            AgentResponse with fixed code and explanation.
        """
        prompt = f"""Debug and fix this {language} code:

ERROR/ISSUE: {error_message}

CODE:
```{language}
{code}
```

Provide:
1. Root cause analysis
2. Fixed code
3. Explanation of the fix
4. How to prevent similar issues"""

        return await self.process(prompt)

    async def explain_code(
        self,
        code: str,
        language: str = "python",
        detail_level: str = "medium",
    ) -> AgentResponse:
        """Explain how code works.

        Args:
            code: The code to explain.
            language: Programming language of the code.
            detail_level: "brief", "medium", or "detailed".

        Returns:
            AgentResponse with explanation.
        """
        detail_instructions = {
            "brief": "Give a concise one-paragraph summary.",
            "medium": "Explain the main components and how they work together.",
            "detailed": "Provide a line-by-line breakdown with examples.",
        }

        prompt = f"""Explain this {language} code:

```{language}
{code}
```

{detail_instructions.get(detail_level, detail_instructions["medium"])}

Include:
- Purpose of the code
- Key concepts used
- How data flows through the code"""

        return await self.process(prompt)
