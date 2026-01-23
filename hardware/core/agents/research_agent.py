"""Research Agent - Gathers and synthesizes information.

The research agent specializes in:
- Web searching and information gathering
- Document analysis and summarization
- Fact-checking and verification
- Knowledge synthesis from multiple sources
- Question answering with citations
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app_logging.logger import get_logger
from core.agents.base_agent import AgentResponse, AgentRole, BaseAgent

logger = get_logger(__name__)


class ResearchType(str, Enum):
    """Types of research tasks."""

    WEB_SEARCH = "web_search"
    DOCUMENT_ANALYSIS = "document_analysis"
    FACT_CHECK = "fact_check"
    COMPARISON = "comparison"
    DEEP_DIVE = "deep_dive"
    SUMMARY = "summary"


@dataclass
class ResearchSource:
    """A source of information."""

    title: str
    url: str | None = None
    content: str = ""
    relevance_score: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ResearchResult:
    """Result of a research task."""

    query: str
    summary: str
    sources: list[ResearchSource] = field(default_factory=list)
    key_findings: list[str] = field(default_factory=list)
    confidence: float = 0.0


class ResearchAgent(BaseAgent):
    """Agent specialized in gathering and synthesizing information.

    Excels at finding relevant information, analyzing documents,
    and providing well-sourced answers to questions.
    """

    def __init__(
        self,
        model_name: str | None = None,
        temperature: float = 0.3,  # Lower temperature for factual accuracy
    ):
        super().__init__(model_name=model_name, temperature=temperature)
        self._knowledge_base: dict[str, Any] = {}

    @property
    def role(self) -> AgentRole:
        return AgentRole.RESEARCHER

    @property
    def system_prompt(self) -> str:
        return """You are an expert researcher and information analyst. Your responsibilities:

1. SEARCH: Find relevant information from available sources
2. ANALYZE: Critically evaluate information quality and relevance
3. SYNTHESIZE: Combine information from multiple sources
4. VERIFY: Cross-check facts and identify contradictions
5. CITE: Always provide sources for claims

RESEARCH PRINCIPLES:
- Accuracy over speed - verify before reporting
- Use multiple sources when possible
- Distinguish between facts, opinions, and speculation
- Note uncertainty and confidence levels
- Provide balanced perspectives on controversial topics
- Cite sources clearly
- Acknowledge knowledge gaps

OUTPUT FORMAT:
```
## Research Report: [Topic]

### Summary
[Concise summary of findings]

### Key Findings
1. [Finding with source]
2. [Finding with source]

### Detailed Analysis
[In-depth analysis]

### Sources
- [Source 1]: [Description]
- [Source 2]: [Description]

### Confidence Level
[High/Medium/Low] - [Explanation]

### Knowledge Gaps
- [What couldn't be determined]
```

Be thorough, accurate, and transparent about limitations."""

    async def research(
        self,
        query: str,
        research_type: ResearchType = ResearchType.WEB_SEARCH,
        depth: str = "standard",
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Conduct research on a topic.

        Args:
            query: The research question or topic.
            research_type: Type of research to conduct.
            depth: Research depth ("quick", "standard", "deep").
            context: Additional context.

        Returns:
            AgentResponse with research findings.
        """
        depth_instructions = {
            "quick": "Provide a brief, focused answer with key facts.",
            "standard": "Provide a comprehensive answer with multiple perspectives.",
            "deep": "Provide an exhaustive analysis covering all aspects and edge cases.",
        }

        prompt = f"""Research the following:

QUERY: {query}
TYPE: {research_type.value}
DEPTH: {depth}

{depth_instructions.get(depth, depth_instructions["standard"])}

Provide:
1. Summary of findings
2. Key facts and data points
3. Multiple perspectives (if applicable)
4. Confidence level in the findings
5. Suggestions for further research
"""

        return await self.process(prompt, context)

    async def analyze_document(
        self,
        document: str,
        questions: list[str] | None = None,
    ) -> AgentResponse:
        """Analyze a document and extract key information.

        Args:
            document: The document content to analyze.
            questions: Specific questions to answer from the document.

        Returns:
            AgentResponse with analysis.
        """
        prompt = f"""Analyze this document:

---
{document}
---
"""

        if questions:
            q_str = "\n".join(f"- {q}" for q in questions)
            prompt += f"\n\nAnswer these questions:\n{q_str}"
        else:
            prompt += """
Extract and provide:
1. Main topic and purpose
2. Key points and arguments
3. Important data or statistics
4. Conclusions or recommendations
5. Notable quotes or statements
"""

        return await self.process(prompt)

    async def summarize(
        self,
        content: str,
        length: str = "medium",
        focus: str | None = None,
    ) -> AgentResponse:
        """Summarize content.

        Args:
            content: The content to summarize.
            length: Summary length ("brief", "medium", "detailed").
            focus: Specific aspect to focus on.

        Returns:
            AgentResponse with summary.
        """
        length_guide = {
            "brief": "2-3 sentences",
            "medium": "1-2 paragraphs",
            "detailed": "comprehensive summary with sections",
        }

        prompt = f"""Summarize the following content in {length_guide.get(length, "1-2 paragraphs")}:

{content}
"""

        if focus:
            prompt += f"\n\nFocus particularly on: {focus}"

        return await self.process(prompt)

    async def fact_check(
        self,
        claims: list[str],
    ) -> AgentResponse:
        """Fact-check a list of claims.

        Args:
            claims: List of claims to verify.

        Returns:
            AgentResponse with fact-check results.
        """
        claims_str = "\n".join(f"{i+1}. {c}" for i, c in enumerate(claims))

        prompt = f"""Fact-check these claims:

{claims_str}

For each claim, provide:
1. Verdict: TRUE / FALSE / PARTIALLY TRUE / UNVERIFIABLE
2. Explanation
3. Supporting evidence or contradicting evidence
4. Confidence level
"""

        return await self.process(prompt)

    async def compare(
        self,
        items: list[str],
        criteria: list[str] | None = None,
    ) -> AgentResponse:
        """Compare multiple items or options.

        Args:
            items: Items to compare.
            criteria: Criteria for comparison.

        Returns:
            AgentResponse with comparison.
        """
        items_str = "\n".join(f"- {item}" for item in items)

        prompt = f"""Compare these items:

{items_str}
"""

        if criteria:
            criteria_str = "\n".join(f"- {c}" for c in criteria)
            prompt += f"\n\nCriteria for comparison:\n{criteria_str}"

        prompt += """

Provide:
1. Comparison table or matrix
2. Pros and cons of each
3. Key differentiators
4. Recommendation based on different use cases
"""

        return await self.process(prompt)

    async def answer_question(
        self,
        question: str,
        context_documents: list[str] | None = None,
    ) -> AgentResponse:
        """Answer a question with citations.

        Args:
            question: The question to answer.
            context_documents: Documents to use as context.

        Returns:
            AgentResponse with answer.
        """
        prompt = f"""Answer this question:

QUESTION: {question}
"""

        if context_documents:
            for i, doc in enumerate(context_documents):
                prompt += f"\n\n--- DOCUMENT {i+1} ---\n{doc}"

        prompt += """

Provide:
1. Direct answer to the question
2. Supporting evidence with citations
3. Confidence level
4. Related questions that might be helpful
"""

        return await self.process(prompt)

    def add_to_knowledge_base(self, key: str, content: Any) -> None:
        """Add information to the agent's knowledge base.

        Args:
            key: Key for the information.
            content: The content to store.
        """
        self._knowledge_base[key] = content
        logger.info(f"Added '{key}' to knowledge base")

    def get_from_knowledge_base(self, key: str) -> Any | None:
        """Retrieve information from the knowledge base.

        Args:
            key: Key to retrieve.

        Returns:
            The stored content or None.
        """
        return self._knowledge_base.get(key)

    def search_knowledge_base(self, query: str) -> list[tuple[str, Any]]:
        """Search the knowledge base for relevant entries.

        Args:
            query: Search query.

        Returns:
            List of (key, content) tuples that match.
        """
        query_lower = query.lower()
        results = []
        for key, content in self._knowledge_base.items():
            if query_lower in key.lower() or (
                isinstance(content, str) and query_lower in content.lower()
            ):
                results.append((key, content))
        return results
