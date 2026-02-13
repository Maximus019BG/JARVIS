"""Tests for OrchestrationRouter hybrid routing (critique #9)."""

import asyncio

import pytest

from core.orchestration import OrchestrationRouter


class _DummyOrchestrator:
    pass


class _ClassifierLLM:
    """LLM stub exposing `chat()` for router classification."""

    def __init__(self, response: str | Exception):
        self._response = response
        self.chat_calls: list[dict] = []

    async def chat(
        self,
        message: str,
        conversation_history=None,
        *,
        system_prompt: str | None = None,
        max_tokens: int = 120,
        temperature: float = 0.0,
    ) -> str:
        self.chat_calls.append(
            {
                "message": message,
                "conversation_history": conversation_history,
                "system_prompt": system_prompt,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
        )
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


class TestOrchestrationRouter:
    def test_no_orchestrator_available_always_false(self):
        router = OrchestrationRouter(orchestrator=None)
        assert router.should_use_orchestrator("Implement a big feature") is False

    def test_legacy_length_trigger_routes_true(self):
        router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
        msg = "x" * 201
        d = router.evaluate(msg)
        assert d.should_route is True
        assert d.is_uncertain is False

    def test_legacy_punctuation_trigger_routes_true(self):
        router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
        msg = "One. Two. Three."
        d = router.evaluate(msg)
        # Legacy punctuation boosts should route to orchestrator.
        assert d.should_route is True

    def test_word_boundary_avoids_false_positive_planet(self):
        router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
        msg = "Tell me about the planet Jupiter"
        d = router.evaluate(msg)
        # Should not match 'plan' in 'planet'; this should be a direct/simple route.
        assert d.should_route is False

    def test_word_boundary_avoids_false_positive_recreate(self):
        router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
        msg = "I want to recreate this painting style"
        d = router.evaluate(msg)
        # Should not match 'create' in 'recreate'.
        assert d.should_route is False

    def test_high_confidence_rules_do_not_call_classifier(self):
        router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
        llm = _ClassifierLLM(
            '{"route_to_orchestrator": false, "confidence": 1, "reason": "n/a"}'
        )

        msg = "Implement a REST API in Python and add pytest tests."
        use_orch = asyncio.run(router.should_use_orchestrator_async(msg, llm))
        assert use_orch is True
        assert llm.chat_calls == []

    def test_low_confidence_rules_do_not_call_classifier(self):
        router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
        llm = _ClassifierLLM(
            '{"route_to_orchestrator": true, "confidence": 1, "reason": "n/a"}'
        )

        msg = "What is the capital of France?"
        use_orch = asyncio.run(router.should_use_orchestrator_async(msg, llm))
        assert use_orch is False
        assert llm.chat_calls == []

    def test_uncertain_score_triggers_classifier_path_true(self):
        router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
        llm = _ClassifierLLM(
            '{"route_to_orchestrator": true, "confidence": 0.7, "reason": "multi-step"}'
        )

        # Craft a message that lands in the uncertainty band (between low/high thresholds)
        msg = "I need help with architecture"  # medium signals, not legacy triggers
        d = router.evaluate(msg)
        assert d.is_uncertain is True

        use_orch = asyncio.run(router.should_use_orchestrator_async(msg, llm))
        assert use_orch is True
        assert len(llm.chat_calls) == 1

    def test_classifier_failure_falls_back_to_rules(self):
        router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
        llm = _ClassifierLLM(ValueError("boom"))

        msg = "I need help with architecture"
        d = router.evaluate(msg)
        assert d.is_uncertain is True

        use_orch = asyncio.run(router.should_use_orchestrator_async(msg, llm))
        assert use_orch is d.should_route

    def test_classifier_truncates_long_input(self):
        router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
        llm = _ClassifierLLM(
            '{"route_to_orchestrator": false, "confidence": 0.6, "reason": "simple"}'
        )

        # Keep length under legacy-length trigger so we're still uncertain and hit classifier.
        msg = ("I need help with architecture " + ("x" * 150)).strip()
        d = router.evaluate(msg)
        assert d.is_uncertain is True

        _ = asyncio.run(router.should_use_orchestrator_async(msg, llm))
        assert len(llm.chat_calls) == 1
        sent = llm.chat_calls[0]["message"]
        assert len(sent) < 2000


@pytest.mark.parametrize(
    "response",
    [
        '{"route_to_orchestrator": true, "confidence": 1, "reason": "ok"}',
        '```json\n{"route_to_orchestrator": false, "confidence": 0.4, "reason": "ok"}\n```',
    ],
)
def test_classifier_accepts_plain_or_fenced_json(response: str):
    router = OrchestrationRouter(orchestrator=_DummyOrchestrator())
    llm = _ClassifierLLM(response)

    msg = "I need help with architecture"
    assert router.evaluate(msg).is_uncertain is True
    _ = asyncio.run(router.should_use_orchestrator_async(msg, llm))
    assert len(llm.chat_calls) == 1
