"""Tests for gesture event system."""

import pytest

from core.vision.gesture_events import GestureEventEmitter
from core.vision.gesture_recognizer import GestureType, GestureResult
from core.vision.hand_detector import HandDetection, Landmark, Handedness


def make_gesture_result(
    gesture: GestureType = GestureType.THUMBS_UP,
    confidence: float = 0.95,
) -> GestureResult:
    """Helper to create a GestureResult for testing."""
    # Create minimal valid HandDetection
    landmarks = tuple(Landmark(x=0.5, y=0.5, z=0.0) for _ in range(21))
    hand = HandDetection(
        landmarks=landmarks,
        handedness=Handedness.RIGHT,
        confidence=0.95,
    )
    return GestureResult(gesture=gesture, confidence=confidence, hand=hand)


class TestGestureEventEmitter:
    """Tests for GestureEventEmitter class."""

    @pytest.mark.asyncio
    async def test_on_registers_handler(self) -> None:
        """Test that on() registers a handler for specific gesture."""
        emitter = GestureEventEmitter()
        received = []

        async def handler(result: GestureResult) -> None:
            received.append(result.gesture)

        emitter.on(GestureType.THUMBS_UP, handler)

        result = make_gesture_result(GestureType.THUMBS_UP)
        await emitter.emit(result)

        assert len(received) == 1
        assert received[0] == GestureType.THUMBS_UP

    @pytest.mark.asyncio
    async def test_handler_not_called_for_different_gesture(self) -> None:
        """Test handler is not called for different gesture types."""
        emitter = GestureEventEmitter()
        received = []

        async def handler(result: GestureResult) -> None:
            received.append(result.gesture)

        emitter.on(GestureType.THUMBS_UP, handler)

        # Emit a different gesture
        result = make_gesture_result(GestureType.PEACE)
        await emitter.emit(result)

        assert len(received) == 0

    @pytest.mark.asyncio
    async def test_on_any_receives_all_gestures(self) -> None:
        """Test on_any handler receives all gestures."""
        emitter = GestureEventEmitter()
        received = []

        async def handler(result: GestureResult) -> None:
            received.append(result.gesture)

        emitter.on_any(handler)

        await emitter.emit(make_gesture_result(GestureType.THUMBS_UP))
        await emitter.emit(make_gesture_result(GestureType.PEACE))
        await emitter.emit(make_gesture_result(GestureType.POINTING))

        assert len(received) == 3
        assert GestureType.THUMBS_UP in received
        assert GestureType.PEACE in received
        assert GestureType.POINTING in received

    @pytest.mark.asyncio
    async def test_off_removes_handler(self) -> None:
        """Test off() removes a specific handler."""
        emitter = GestureEventEmitter()
        received = []

        async def handler(result: GestureResult) -> None:
            received.append(result.gesture)

        emitter.on(GestureType.THUMBS_UP, handler)
        emitter.off(GestureType.THUMBS_UP, handler)

        await emitter.emit(make_gesture_result(GestureType.THUMBS_UP))

        assert len(received) == 0

    @pytest.mark.asyncio
    async def test_multiple_handlers_same_gesture(self) -> None:
        """Test multiple handlers can be registered for same gesture."""
        emitter = GestureEventEmitter()
        results = {"handler1": False, "handler2": False}

        async def handler1(result: GestureResult) -> None:
            results["handler1"] = True

        async def handler2(result: GestureResult) -> None:
            results["handler2"] = True

        emitter.on(GestureType.THUMBS_UP, handler1)
        emitter.on(GestureType.THUMBS_UP, handler2)

        await emitter.emit(make_gesture_result(GestureType.THUMBS_UP))

        assert results["handler1"] is True
        assert results["handler2"] is True

    @pytest.mark.asyncio
    async def test_clear_removes_all_handlers(self) -> None:
        """Test clear() removes all handlers."""
        emitter = GestureEventEmitter()
        received = []

        async def handler(result: GestureResult) -> None:
            received.append(result.gesture)

        emitter.on(GestureType.THUMBS_UP, handler)
        emitter.on(GestureType.PEACE, handler)
        emitter.on_any(handler)

        emitter.clear()

        await emitter.emit(make_gesture_result(GestureType.THUMBS_UP))

        assert len(received) == 0

    @pytest.mark.asyncio
    async def test_clear_specific_gesture(self) -> None:
        """Test clear() can clear handlers for specific gesture only."""
        emitter = GestureEventEmitter()
        received = []

        async def handler(result: GestureResult) -> None:
            received.append(result.gesture)

        emitter.on(GestureType.THUMBS_UP, handler)
        emitter.on(GestureType.PEACE, handler)

        emitter.clear(GestureType.THUMBS_UP)

        await emitter.emit(make_gesture_result(GestureType.THUMBS_UP))
        await emitter.emit(make_gesture_result(GestureType.PEACE))

        assert len(received) == 1
        assert received[0] == GestureType.PEACE

    def test_handler_count(self) -> None:
        """Test handler_count returns correct counts."""
        emitter = GestureEventEmitter()

        async def handler(result: GestureResult) -> None:
            pass

        assert emitter.handler_count() == 0

        emitter.on(GestureType.THUMBS_UP, handler)
        assert emitter.handler_count() == 1
        assert emitter.handler_count(GestureType.THUMBS_UP) == 1
        assert emitter.handler_count(GestureType.PEACE) == 0

        emitter.on_any(handler)
        assert emitter.handler_count() == 2

    @pytest.mark.asyncio
    async def test_handler_exception_does_not_break_others(self) -> None:
        """Test that one handler's exception doesn't prevent others."""
        emitter = GestureEventEmitter()
        results = {"good_handler": False}

        async def bad_handler(result: GestureResult) -> None:
            raise ValueError("Intentional test error")

        async def good_handler(result: GestureResult) -> None:
            results["good_handler"] = True

        emitter.on(GestureType.THUMBS_UP, bad_handler)
        emitter.on(GestureType.THUMBS_UP, good_handler)

        # Should not raise, exceptions are gathered
        await emitter.emit(make_gesture_result(GestureType.THUMBS_UP))

        # Good handler should still have been called
        assert results["good_handler"] is True
