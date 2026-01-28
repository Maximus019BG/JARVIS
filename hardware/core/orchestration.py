"""Orchestrator routing and execution helpers.

This module extracts the orchestration decision + runner logic out of `ChatHandler`.
Behavior is intentionally kept compatible with the prior inlined implementation.

Critique #9: routing is now *rules-first* with a weighted score using robust
word-boundary regex matching. If the rules score is uncertain, we optionally
use a cheap LLM classification call (no tools) to decide whether to route to the
orchestrator.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app_logging.logger import get_logger

if TYPE_CHECKING:
    from core.agents import OrchestratorAgent
    from core.llm.provider_factory import LLMProvider
    from core.memory import UnifiedMemoryManager

logger = get_logger(__name__)


# Keywords that suggest complex tasks needing orchestration (kept for backwards-compatibility
# and as seeds for the rules-based scorer).
ORCHESTRATION_KEYWORDS = [
    "create",
    "build",
    "implement",
    "develop",
    "design",
    "plan",
    "analyze",
    "research",
    "review",
    "improve",
    "refactor",
    "debug",
    "fix",
    "optimize",
    "write code",
    "make a",
    "help me",
    "can you",
    "i need",
    "i want",
    "blueprint",
    "architecture",
    "system",
    "project",
]


# ----------------------------
# Routing scoring configuration
# ----------------------------

# Deterministic bands (tunable)
ROUTING_HIGH_CONFIDENCE_THRESHOLD = 3.0
ROUTING_LOW_CONFIDENCE_THRESHOLD = 0.5

# Preserve previous hard thresholds by boosting score into the high-confidence band.
LEGACY_LENGTH_TRIGGER = 200
LEGACY_LENGTH_BOOST = 3.0
LEGACY_PUNCT_DOT_TRIGGER = 3
LEGACY_PUNCT_COMMA_TRIGGER = 4
LEGACY_PUNCT_BOOST = 2.0

# Complexity heuristics
ENUMERATION_LINE_RE = re.compile(r"^\s*(?:[-*]|\d+\.)\s+", re.MULTILINE)
CODE_FENCE_RE = re.compile(r"```")

# Tooling / execution triggers
FILE_EXT_RE = re.compile(r"\.(?:py|ts|js|java|go|rs|md|yaml|yml|json)\b", re.IGNORECASE)
PATH_LIKE_RE = re.compile(r"(?:^|\s)(?:[./\\][^\s]+)")
ERROR_TERMS_RE = re.compile(
    r"\b(?:traceback|stack trace|exception|error|failed?|fails?|crash|bug)\b",
    re.IGNORECASE,
)
TOOLING_TERMS_RE = re.compile(
    r"\b(?:test|tests|pytest|unittest|npm|pip|poetry|uv|docker|kubernetes|git|github|ci|cd)\b",
    re.IGNORECASE,
)


def _token_boundary_regex(token: str) -> re.Pattern[str]:
    """Compile a case-insensitive word-boundary regex for a single token."""

    # Use \b boundaries to avoid substring false positives (plan vs planet).
    return re.compile(rf"\b{re.escape(token)}\b", re.IGNORECASE)


def _phrase_boundary_regex(phrase: str) -> re.Pattern[str]:
    """Compile a case-insensitive regex for a multi-word phrase.

    This matches each token with word boundaries, allowing whitespace between.
    """

    tokens = [t for t in phrase.split() if t]
    if not tokens:
        return re.compile(r"$^")

    parts = [rf"\b{re.escape(tokens[0])}\b"]
    for t in tokens[1:]:
        parts.append(r"\s+")
        parts.append(rf"\b{re.escape(t)}\b")

    return re.compile("".join(parts), re.IGNORECASE)


@dataclass(frozen=True)
class RoutingDecision:
    """Result of evaluating a message for orchestration routing."""

    score: float
    should_route: bool
    is_uncertain: bool
    reasons: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class _WeightedPattern:
    name: str
    pattern: re.Pattern[str]
    weight: float


# Weighted feature groups (tunable).
_WEIGHTED_PATTERNS: list[_WeightedPattern] = [
    # 1) Explicit build/change intent (high)
    _WeightedPattern("intent:create", _token_boundary_regex("create"), 1.2),
    _WeightedPattern("intent:build", _token_boundary_regex("build"), 1.2),
    _WeightedPattern("intent:implement", _token_boundary_regex("implement"), 1.4),
    _WeightedPattern("intent:develop", _token_boundary_regex("develop"), 1.2),
    _WeightedPattern("intent:design", _token_boundary_regex("design"), 1.0),
    _WeightedPattern("intent:refactor", _token_boundary_regex("refactor"), 1.3),
    _WeightedPattern("intent:debug", _token_boundary_regex("debug"), 1.3),
    _WeightedPattern("intent:fix", _token_boundary_regex("fix"), 1.3),
    _WeightedPattern("intent:optimize", _token_boundary_regex("optimize"), 1.3),
    _WeightedPattern("intent:write_code", _phrase_boundary_regex("write code"), 1.6),
    _WeightedPattern("intent:make_a", _phrase_boundary_regex("make a"), 1.0),
    _WeightedPattern("intent:help_me", _phrase_boundary_regex("help me"), 0.4),
    # 2) Project/system language (medium)
    _WeightedPattern("domain:blueprint", _token_boundary_regex("blueprint"), 0.9),
    _WeightedPattern("domain:architecture", _token_boundary_regex("architecture"), 0.9),
    _WeightedPattern("domain:system", _token_boundary_regex("system"), 0.6),
    _WeightedPattern("domain:project", _token_boundary_regex("project"), 0.6),
    _WeightedPattern("domain:agent", _token_boundary_regex("agent"), 0.6),
    _WeightedPattern("domain:tool", _token_boundary_regex("tool"), 0.5),
    _WeightedPattern("domain:repository", _token_boundary_regex("repository"), 0.6),
    # 4) Tooling/execution triggers (medium-high)
    _WeightedPattern("signal:file_ext", FILE_EXT_RE, 1.1),
    _WeightedPattern("signal:path_like", PATH_LIKE_RE, 0.8),
    _WeightedPattern("signal:error_terms", ERROR_TERMS_RE, 1.1),
    _WeightedPattern("signal:tooling_terms", TOOLING_TERMS_RE, 1.0),
    _WeightedPattern("signal:code_fence", CODE_FENCE_RE, 0.8),
    # 5) Downgrade chatty/simple intent (negative)
    _WeightedPattern("downgrade:what_is", _phrase_boundary_regex("what is"), -0.8),
    _WeightedPattern("downgrade:define", _token_boundary_regex("define"), -0.7),
    _WeightedPattern("downgrade:explain", _token_boundary_regex("explain"), -0.6),
    _WeightedPattern("downgrade:translate", _token_boundary_regex("translate"), -0.8),
    _WeightedPattern("downgrade:summarize", _token_boundary_regex("summarize"), -0.6),
]


def _normalized_punctuation_score(message: str) -> float:
    """Return a small score based on punctuation density."""

    if not message:
        return 0.0

    n = max(len(message), 1)
    dots = message.count(".")
    commas = message.count(",")

    # Normalize counts by length to reduce brittleness.
    density = (dots + commas) / (n / 100.0)

    # Cap to avoid over-weighting very punctuated text.
    return min(1.0, density / 8.0)  # ~1.0 around 8 punct/100 chars


def _count_feature_hits(message: str, pattern: re.Pattern[str]) -> int:
    """Count non-overlapping hits for a pattern, capped to keep weights stable."""

    try:
        hits = len(pattern.findall(message))
    except re.error:
        return 0

    # Cap repetitions so one word repeated doesn't dominate.
    return min(hits, 3)


class OrchestrationRouter:
    """Determines when to route a message to the orchestrator."""

    def __init__(self, orchestrator: "OrchestratorAgent | None") -> None:
        self._orchestrator = orchestrator

    def evaluate(self, message: str) -> RoutingDecision:
        """Evaluate a message and return a routing decision with score + uncertainty."""

        if not self._orchestrator:
            # If orchestrator isn't available, routing is always false.
            return RoutingDecision(
                score=0.0,
                should_route=False,
                is_uncertain=False,
                reasons={"no_orchestrator": 1.0},
            )

        msg = message or ""
        score = 0.0
        reasons: dict[str, float] = {}

        # Legacy compatibility boosts (hard triggers)
        if len(msg) > LEGACY_LENGTH_TRIGGER:
            score += LEGACY_LENGTH_BOOST
            reasons["legacy:length"] = LEGACY_LENGTH_BOOST

        if (
            msg.count(".") >= LEGACY_PUNCT_DOT_TRIGGER
            or msg.count(",") >= LEGACY_PUNCT_COMMA_TRIGGER
        ):
            score += LEGACY_PUNCT_BOOST
            reasons["legacy:punct"] = LEGACY_PUNCT_BOOST

        # Weighted patterns
        for wp in _WEIGHTED_PATTERNS:
            hits = _count_feature_hits(msg, wp.pattern)
            if hits:
                delta = wp.weight * float(hits)
                score += delta
                reasons[wp.name] = reasons.get(wp.name, 0.0) + delta

        # Complexity signals
        punct_score = _normalized_punctuation_score(msg) * 0.7
        if punct_score:
            score += punct_score
            reasons["complexity:punct_density"] = punct_score

        enum_hits = len(ENUMERATION_LINE_RE.findall(msg))
        if enum_hits:
            delta = min(1.2, 0.4 * enum_hits)
            score += delta
            reasons["complexity:enumeration"] = delta

        # Clause-ish: multiple sentences or conjunctions, small signal.
        if msg.count(";") >= 1 or re.search(
            r"\b(?:and|then|also|but)\b", msg, re.IGNORECASE
        ):
            score += 0.3
            reasons["complexity:multi_clause"] = 0.3

        # Small downgrade for very short messages without strong signals.
        if len(msg.strip()) <= 20:
            score -= 0.3
            reasons["downgrade:very_short"] = -0.3

        should_route = score >= ROUTING_HIGH_CONFIDENCE_THRESHOLD
        should_direct = score <= ROUTING_LOW_CONFIDENCE_THRESHOLD
        is_uncertain = not (should_route or should_direct)

        if is_uncertain:
            # Default rules fallback decision within uncertain band:
            # lean direct unless there are explicit intent/tooling signals.
            intent_or_tooling = any(
                k.startswith("intent:")
                or k.startswith("signal:")
                or k.startswith("legacy:")
                for k in reasons.keys()
            )
            should_route = bool(intent_or_tooling and score >= 1.2)

        return RoutingDecision(
            score=score,
            should_route=should_route,
            is_uncertain=is_uncertain,
            reasons=reasons,
        )

    def should_use_orchestrator(self, message: str) -> bool:
        """Return True if the message should be handled by the orchestrator.

        Backwards-compatible wrapper around [`OrchestrationRouter.evaluate()`](hardware/core/orchestration.py:193).
        """

        return self.evaluate(message).should_route

    async def should_use_orchestrator_async(
        self, message: str, llm: "LLMProvider | None"
    ) -> bool:
        """Hybrid router: rules-first, LLM classifier fallback when uncertain."""

        decision = self.evaluate(message)

        if not decision.is_uncertain:
            logger.debug(
                "Routing decision via rules: route=%s score=%.2f reasons=%s",
                decision.should_route,
                decision.score,
                sorted(decision.reasons.items(), key=lambda kv: -abs(kv[1]))[:5],
            )
            return decision.should_route

        if llm is None:
            logger.debug(
                "Routing uncertain (no LLM); falling back to rules: route=%s score=%.2f",
                decision.should_route,
                decision.score,
            )
            return decision.should_route

        try:
            clf = await _classify_route_to_orchestrator(
                llm, message=message, score=decision.score
            )
            if clf is None:
                logger.debug(
                    "Routing classifier returned no decision; falling back to rules: route=%s score=%.2f",
                    decision.should_route,
                    decision.score,
                )
                return decision.should_route

            logger.debug(
                "Routing decision via classifier: route=%s confidence=%.2f score=%.2f reason=%s",
                clf["route_to_orchestrator"],
                clf.get("confidence", 0.0),
                decision.score,
                clf.get("reason", ""),
            )
            return bool(clf["route_to_orchestrator"])

        except Exception as exc:
            logger.debug(
                "Routing classifier failed (%s); falling back to rules: route=%s score=%.2f",
                exc,
                decision.should_route,
                decision.score,
            )
            return decision.should_route


async def _classify_route_to_orchestrator(
    llm: "LLMProvider",
    *,
    message: str,
    score: float,
    max_chars: int = 800,
    max_tokens: int = 120,
) -> dict[str, Any] | None:
    """Ask the LLM for a cheap JSON classification. Returns None on parse errors."""

    # Truncate for safety/perf.
    clipped = message or ""
    if len(clipped) > max_chars:
        clipped = clipped[:max_chars]

    system_prompt = (
        "You are a router. Decide if the user request requires multi-step planning, "
        "coordination across tools/agents, code changes, debugging, or project-level work. "
        "Return ONLY JSON with keys: route_to_orchestrator (boolean), confidence (number 0..1), reason (string)."
    )

    user_prompt = (
        "Message:\n"
        f"{clipped}\n\n"
        "Routing guidance: route_to_orchestrator=true if the request likely benefits from multi-step decomposition, "
        "tool execution, or changes across multiple files. Otherwise false.\n"
        f"Rules score: {score:.2f} (uncertain band)"
    )

    if not hasattr(llm, "chat"):
        return None

    raw = await llm.chat(
        user_prompt,
        conversation_history=None,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
        temperature=0.0,
    )

    if raw is None:
        return None

    # Some providers may wrap JSON in markdown fences; try to extract the first JSON object.
    text = str(raw).strip()
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if match:
        text = match.group(0)

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None

    if not isinstance(data, dict):
        return None

    if "route_to_orchestrator" not in data:
        return None

    rte = data.get("route_to_orchestrator")
    if not isinstance(rte, bool):
        return None

    conf = data.get("confidence", 0.0)
    try:
        conf_f = float(conf)
    except (TypeError, ValueError):
        conf_f = 0.0

    reason = data.get("reason", "")
    if reason is None:
        reason = ""

    return {
        "route_to_orchestrator": rte,
        "confidence": max(0.0, min(1.0, conf_f)),
        "reason": str(reason),
    }


class OrchestrationRunner:
    """Runs the orchestrator workflow and applies metadata/footer formatting."""

    def __init__(
        self,
        orchestrator: "OrchestratorAgent",
        memory_manager: "UnifiedMemoryManager | None",
        logger_override=None,
    ) -> None:
        self._orchestrator = orchestrator
        self._memory_manager = memory_manager
        self._logger = logger_override or logger

    async def run(self, message: str, fallback_coro) -> str:
        """Run orchestration; on failure, fall back to the provided coroutine.

        Args:
            message: User message.
            fallback_coro: Callable returning awaitable[str] to use on failure.

        Returns:
            Response string.
        """

        start_time = time.time()

        try:
            context: dict = {}
            if self._memory_manager:
                context["memory_context"] = self._memory_manager.get_context_for_prompt(
                    500
                )

            response = await self._orchestrator.orchestrate(message, context)

            if self._memory_manager:
                from core.memory import EventType

                self._memory_manager.record_event(
                    description=f"Orchestrated task: {message[:50]}...",
                    event_type=EventType.TASK_COMPLETE,
                    success=response.success,
                    importance=0.7,
                )

            elapsed = time.time() - start_time
            self._logger.info("Orchestration completed in %.2fs", elapsed)

            meta = response.metadata
            if meta.get("subtasks_total"):
                footer = f"\n\n---\n📊 Completed {meta['subtasks_completed']}/{meta['subtasks_total']} subtasks"
                if meta.get("subtasks_failed"):
                    footer += f" ({meta['subtasks_failed']} failed)"
                return response.content + footer

            return response.content

        except Exception as exc:
            self._logger.error("Orchestration failed: %s", exc)
            return await fallback_coro()
