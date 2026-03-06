"""Tests for core.blueprint_gesture.interaction_modes."""

from __future__ import annotations

from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from core.blueprint_gesture.interaction_modes import (
    GestureSequenceDetector,
    InteractionContext,
    InteractionController,
    InteractionState,
)


# ---------------------------------------------------------------------------
# InteractionState & InteractionContext
# ---------------------------------------------------------------------------

class TestInteractionState:
    def test_all_states_exist(self):
        names = [s.name for s in InteractionState]
        for expected in ("IDLE", "SELECTING", "MOVING", "ROTATING", "SCALING",
                         "DRAWING", "PANNING", "ZOOMING", "CONFIRMING"):
            assert expected in names


class TestInteractionContext:
    def test_defaults(self):
        ctx = InteractionContext()
        assert ctx.state == InteractionState.IDLE
        assert ctx.start_position is None
        assert ctx.gesture_count == 0
        assert ctx.selected_ids == []
        assert ctx.metadata == {}


# ---------------------------------------------------------------------------
# Helper to build controller with mocked engine
# ---------------------------------------------------------------------------

def _make_controller():
    engine = MagicMock()
    engine.cancel_transform = MagicMock()
    engine.end_transform = MagicMock()
    engine.has_selection.return_value = True
    engine.get_selection_bounds.return_value = None
    ctrl = InteractionController(engine)
    return ctrl, engine


# ---------------------------------------------------------------------------
# InteractionController – basic
# ---------------------------------------------------------------------------

class TestInteractionControllerBasic:
    def test_initial_state(self):
        ctrl, _ = _make_controller()
        assert ctrl.state == InteractionState.IDLE

    def test_context(self):
        ctrl, _ = _make_controller()
        assert isinstance(ctrl.context, InteractionContext)

    def test_set_tool_manager(self):
        ctrl, _ = _make_controller()
        tm = MagicMock()
        ctrl.set_tool_manager(tm)
        assert ctrl._tool_manager is tm

    def test_on_state_change_callback(self):
        ctrl, engine = _make_controller()
        calls = []
        ctrl.on_state_change(lambda old, new: calls.append((old, new)))
        # Force a transition
        ctrl._transition_to(InteractionState.SELECTING, (0, 0))
        assert len(calls) == 1
        assert calls[0] == (InteractionState.IDLE, InteractionState.SELECTING)


# ---------------------------------------------------------------------------
# on_gesture low confidence
# ---------------------------------------------------------------------------

class TestOnGestureLowConfidence:
    def test_skips_low_confidence(self):
        ctrl, _ = _make_controller()
        from core.vision.gesture_recognizer import GestureType
        result = ctrl.on_gesture(GestureType.POINTING, (0.5, 0.5), confidence=0.3)
        assert result is False


# ---------------------------------------------------------------------------
# cancel / confirm
# ---------------------------------------------------------------------------

class TestCancelConfirm:
    def test_cancel_from_idle(self):
        ctrl, _ = _make_controller()
        ctrl.cancel()
        assert ctrl.state == InteractionState.IDLE

    def test_cancel_from_moving(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.MOVING, (0, 0))
        ctrl.cancel()
        engine.cancel_transform.assert_called_once()
        assert ctrl.state == InteractionState.IDLE

    def test_cancel_from_rotating(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.ROTATING, (0, 0))
        ctrl.cancel()
        engine.cancel_transform.assert_called_once()

    def test_cancel_from_scaling(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.SCALING, (0, 0))
        ctrl.cancel()
        engine.cancel_transform.assert_called_once()

    def test_cancel_from_drawing(self):
        ctrl, _ = _make_controller()
        tm = MagicMock()
        ctrl.set_tool_manager(tm)
        ctrl._transition_to(InteractionState.DRAWING, (0, 0))
        ctrl.cancel()
        tm.cancel_current_operation.assert_called_once()

    def test_confirm_from_moving(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.MOVING, (0, 0))
        ctrl.confirm()
        engine.end_transform.assert_called_once()
        assert ctrl.state == InteractionState.IDLE

    def test_confirm_from_drawing(self):
        ctrl, _ = _make_controller()
        tm = MagicMock()
        ctrl.set_tool_manager(tm)
        ctrl._transition_to(InteractionState.DRAWING, (1, 2))
        ctrl.confirm()
        tm.finish.assert_called_once()


# ---------------------------------------------------------------------------
# _handle_idle – various engine modes
# ---------------------------------------------------------------------------

class TestHandleIdle:
    def _gesture(self, ctrl, engine, gesture, mode_value, pos=(0.5, 0.5)):
        from core.vision.gesture_recognizer import GestureType
        type(engine).mode = PropertyMock(return_value=mode_value)
        gesture_enum = getattr(GestureType, gesture)
        ctrl.on_gesture(gesture_enum, pos)

    def test_select_pointing(self):
        from core.blueprint.engine import InteractionMode
        ctrl, engine = _make_controller()
        self._gesture(ctrl, engine, "POINTING", InteractionMode.SELECT)
        engine.select_at_point.assert_called_once()
        assert ctrl.state == InteractionState.SELECTING

    def test_translate_fist(self):
        from core.blueprint.engine import InteractionMode
        ctrl, engine = _make_controller()
        self._gesture(ctrl, engine, "CLOSED_FIST", InteractionMode.TRANSLATE)
        engine.begin_translate.assert_called_once()
        assert ctrl.state == InteractionState.MOVING

    def test_rotate_fist(self):
        from core.blueprint.engine import InteractionMode
        ctrl, engine = _make_controller()
        self._gesture(ctrl, engine, "CLOSED_FIST", InteractionMode.ROTATE)
        engine.begin_rotate.assert_called_once()
        assert ctrl.state == InteractionState.ROTATING

    def test_scale_pinch(self):
        from core.blueprint.engine import InteractionMode
        ctrl, engine = _make_controller()
        self._gesture(ctrl, engine, "PINCH", InteractionMode.SCALE)
        engine.begin_scale.assert_called_once()
        assert ctrl.state == InteractionState.SCALING

    def test_global_peace_undo(self):
        from core.blueprint.engine import InteractionMode
        from core.vision.gesture_recognizer import GestureType
        ctrl, engine = _make_controller()
        # SELECT mode + PEACE gesture: inner if (POINTING) doesn't match,
        # so falls through to global gesture handling
        type(engine).mode = PropertyMock(return_value=InteractionMode.SELECT)
        ctrl.on_gesture(GestureType.PEACE, (0.5, 0.5))
        engine.undo.assert_called_once()

    def test_global_ok_sign_snap(self):
        from core.blueprint.engine import InteractionMode
        from core.vision.gesture_recognizer import GestureType
        ctrl, engine = _make_controller()
        type(engine).mode = PropertyMock(return_value=InteractionMode.SELECT)
        ctrl.on_gesture(GestureType.OK_SIGN, (0.5, 0.5))
        engine.toggle_snap_to_grid.assert_called_once()

    def test_global_call_me_grid(self):
        from core.blueprint.engine import InteractionMode
        from core.vision.gesture_recognizer import GestureType
        ctrl, engine = _make_controller()
        type(engine).mode = PropertyMock(return_value=InteractionMode.SELECT)
        ctrl.on_gesture(GestureType.CALL_ME, (0.5, 0.5))
        engine.toggle_grid_visible.assert_called_once()


# ---------------------------------------------------------------------------
# _handle_selecting
# ---------------------------------------------------------------------------

class TestHandleSelecting:
    def test_deselect_with_open_palm(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.SELECTING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.OPEN_PALM, (0.5, 0.5))
        engine.deselect_all.assert_called_once()
        assert ctrl.state == InteractionState.IDLE

    def test_pointing_adds_selection(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.SELECTING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.POINTING, (0.5, 0.5))
        engine.select_at_point.assert_called()

    def test_fist_starts_moving(self):
        ctrl, engine = _make_controller()
        engine.has_selection.return_value = True
        ctrl._transition_to(InteractionState.SELECTING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.CLOSED_FIST, (0.5, 0.5))
        assert ctrl.state == InteractionState.MOVING


# ---------------------------------------------------------------------------
# _handle_moving
# ---------------------------------------------------------------------------

class TestHandleMoving:
    def test_thumbs_up_confirms(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.MOVING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_UP, (0.5, 0.5))
        engine.end_transform.assert_called_once()
        assert ctrl.state == InteractionState.IDLE

    def test_thumbs_down_cancels(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.MOVING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_DOWN, (0.5, 0.5))
        engine.cancel_transform.assert_called_once()

    def test_fist_updates_transform(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.MOVING, (0.1, 0.1))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.CLOSED_FIST, (0.5, 0.5))
        engine.update_transform.assert_called_once()


# ---------------------------------------------------------------------------
# _handle_rotating
# ---------------------------------------------------------------------------

class TestHandleRotating:
    def test_thumbs_up_confirms(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.ROTATING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_UP, (0.5, 0.5))
        engine.end_transform.assert_called_once()

    def test_thumbs_down_cancels(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.ROTATING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_DOWN, (0.5, 0.5))
        engine.cancel_transform.assert_called_once()

    def test_fist_rotates_with_bounds(self):
        ctrl, engine = _make_controller()
        bounds = MagicMock()
        bounds.min_x, bounds.max_x = 0.0, 1.0
        bounds.min_y, bounds.max_y = 0.0, 1.0
        engine.get_selection_bounds.return_value = bounds
        ctrl._transition_to(InteractionState.ROTATING, (0.25, 0.25))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.CLOSED_FIST, (0.75, 0.75))
        engine.update_transform.assert_called_once()


# ---------------------------------------------------------------------------
# _handle_scaling
# ---------------------------------------------------------------------------

class TestHandleScaling:
    def test_thumbs_up_confirms(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.SCALING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_UP, (0.5, 0.5))
        engine.end_transform.assert_called_once()

    def test_pinch_no_crash(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.SCALING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.PINCH, (0.5, 0.5))
        # Just verify no crash (scaling with pinch is a no-op currently)


# ---------------------------------------------------------------------------
# _handle_drawing
# ---------------------------------------------------------------------------

class TestHandleDrawing:
    def test_thumbs_up_finishes(self):
        ctrl, _ = _make_controller()
        tm = MagicMock()
        ctrl.set_tool_manager(tm)
        ctrl._transition_to(InteractionState.DRAWING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_UP, (0.5, 0.5))
        tm.finish.assert_called()
        assert ctrl.state == InteractionState.IDLE

    def test_thumbs_down_cancels(self):
        ctrl, _ = _make_controller()
        tm = MagicMock()
        ctrl.set_tool_manager(tm)
        ctrl._transition_to(InteractionState.DRAWING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_DOWN, (0.5, 0.5))
        tm.cancel_current_operation.assert_called()

    def test_pointing_continues(self):
        ctrl, _ = _make_controller()
        tm = MagicMock()
        ctrl.set_tool_manager(tm)
        ctrl._transition_to(InteractionState.DRAWING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.POINTING, (0.5, 0.5))
        tm.continue_draw.assert_called()


# ---------------------------------------------------------------------------
# _handle_panning
# ---------------------------------------------------------------------------

class TestHandlePanning:
    def test_palm_pans(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.PANNING, (0.1, 0.1))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.OPEN_PALM, (0.5, 0.5))
        engine.pan.assert_called()

    def test_non_pan_gesture_returns_to_idle(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.PANNING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_UP, (0.5, 0.5))
        assert ctrl.state == InteractionState.IDLE


# ---------------------------------------------------------------------------
# _handle_zooming
# ---------------------------------------------------------------------------

class TestHandleZooming:
    def test_swipe_up_zooms_in(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.ZOOMING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.SWIPE_UP, (0.5, 0.5))
        engine.zoom_in.assert_called_once()

    def test_swipe_down_zooms_out(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.ZOOMING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.SWIPE_DOWN, (0.5, 0.5))
        engine.zoom_out.assert_called_once()

    def test_other_exits(self):
        ctrl, engine = _make_controller()
        ctrl._transition_to(InteractionState.ZOOMING, (0, 0))
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.POINTING, (0.5, 0.5))
        assert ctrl.state == InteractionState.IDLE


# ---------------------------------------------------------------------------
# _handle_confirming
# ---------------------------------------------------------------------------

class TestHandleConfirming:
    def test_thumbs_up_calls_confirm_callback(self):
        ctrl, _ = _make_controller()
        called = []
        ctrl._transition_to(InteractionState.CONFIRMING, (0, 0))
        ctrl._context.metadata["confirm_callback"] = lambda: called.append(True)
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_UP, (0.5, 0.5))
        assert called == [True]

    def test_thumbs_down_calls_cancel_callback(self):
        ctrl, _ = _make_controller()
        called = []
        ctrl._transition_to(InteractionState.CONFIRMING, (0, 0))
        ctrl._context.metadata["cancel_callback"] = lambda: called.append(True)
        from core.vision.gesture_recognizer import GestureType
        ctrl.on_gesture(GestureType.THUMBS_DOWN, (0.5, 0.5))
        assert called == [True]


# ---------------------------------------------------------------------------
# GestureSequenceDetector
# ---------------------------------------------------------------------------

class TestGestureSequenceDetector:
    def test_register_and_match(self):
        from core.vision.gesture_recognizer import GestureType
        detector = GestureSequenceDetector(timeout=1.0)
        called = []
        detector.register_pattern(
            (GestureType.POINTING, GestureType.POINTING),
            lambda: called.append("double_tap"),
        )
        detector.on_gesture(GestureType.POINTING, 0.0)
        matched = detector.on_gesture(GestureType.POINTING, 0.1)
        assert matched is True
        assert called == ["double_tap"]

    def test_timeout_expires(self):
        from core.vision.gesture_recognizer import GestureType
        detector = GestureSequenceDetector(timeout=0.5)
        called = []
        detector.register_pattern(
            (GestureType.POINTING, GestureType.POINTING),
            lambda: called.append("tap"),
        )
        detector.on_gesture(GestureType.POINTING, 0.0)
        matched = detector.on_gesture(GestureType.POINTING, 1.0)  # > timeout
        assert matched is False
        assert called == []

    def test_clear(self):
        from core.vision.gesture_recognizer import GestureType
        detector = GestureSequenceDetector()
        detector.on_gesture(GestureType.POINTING, 0.0)
        detector.clear()
        assert detector._sequence == []

    def test_no_match(self):
        from core.vision.gesture_recognizer import GestureType
        detector = GestureSequenceDetector()
        result = detector.on_gesture(GestureType.THUMBS_UP, 0.0)
        assert result is False
