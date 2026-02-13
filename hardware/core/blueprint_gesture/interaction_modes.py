"""Gesture-driven interaction modes for blueprint editing.

Manages the interaction state machine that controls how gestures
are interpreted based on current mode.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine, InteractionMode
    from core.blueprint.drawing.tools import ToolManager, ToolType
    from core.vision.gesture_recognizer import GestureType


class InteractionState(Enum):
    """High-level interaction states."""

    IDLE = auto()  # Waiting for gesture
    SELECTING = auto()  # Performing selection
    MOVING = auto()  # Translating object(s)
    ROTATING = auto()  # Rotating object(s)
    SCALING = auto()  # Scaling object(s)
    DRAWING = auto()  # Drawing with tool
    PANNING = auto()  # Panning view
    ZOOMING = auto()  # Zooming view
    CONFIRMING = auto()  # Waiting for confirm/cancel


@dataclass
class InteractionContext:
    """Context for current interaction."""

    state: InteractionState = InteractionState.IDLE
    start_position: tuple[float, float] | None = None
    current_position: tuple[float, float] | None = None
    start_time: float = 0.0
    gesture_count: int = 0  # For multi-gesture sequences
    selected_ids: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class InteractionController:
    """Controls gesture-based interaction with blueprints.

    Manages the state machine that determines how gestures are
    interpreted based on current mode and context.

    Usage:
        controller = InteractionController(engine)
        controller.on_gesture(GestureType.POINTING, position=(0.5, 0.5))
    """

    def __init__(self, engine: "BlueprintEngine") -> None:
        """Initialize interaction controller.

        Args:
            engine: Blueprint engine to control.
        """
        self._engine = engine
        self._context = InteractionContext()
        self._tool_manager: ToolManager | None = None

        # State transition handlers
        self._state_handlers: dict[
            InteractionState,
            Callable[["GestureType", tuple[float, float]], InteractionState | None],
        ] = {
            InteractionState.IDLE: self._handle_idle,
            InteractionState.SELECTING: self._handle_selecting,
            InteractionState.MOVING: self._handle_moving,
            InteractionState.ROTATING: self._handle_rotating,
            InteractionState.SCALING: self._handle_scaling,
            InteractionState.DRAWING: self._handle_drawing,
            InteractionState.PANNING: self._handle_panning,
            InteractionState.ZOOMING: self._handle_zooming,
            InteractionState.CONFIRMING: self._handle_confirming,
        }

        # Callbacks
        self._state_change_handlers: list[
            Callable[[InteractionState, InteractionState], None]
        ] = []

    @property
    def state(self) -> InteractionState:
        """Get current interaction state."""
        return self._context.state

    @property
    def context(self) -> InteractionContext:
        """Get current interaction context."""
        return self._context

    def set_tool_manager(self, manager: "ToolManager") -> None:
        """Set the drawing tool manager.

        Args:
            manager: Tool manager for drawing operations.
        """
        self._tool_manager = manager

    def on_state_change(
        self,
        handler: Callable[[InteractionState, InteractionState], None],
    ) -> None:
        """Register state change handler.

        Args:
            handler: Callback(old_state, new_state).
        """
        self._state_change_handlers.append(handler)

    def on_gesture(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
        confidence: float = 1.0,
    ) -> bool:
        """Handle a gesture input.

        Args:
            gesture: Type of gesture detected.
            position: Position in blueprint coordinates.
            confidence: Gesture confidence (0-1).

        Returns:
            True if gesture was handled.
        """
        # Skip low-confidence gestures
        if confidence < 0.7:
            return False

        # Update position
        self._context.current_position = position

        # Get handler for current state
        handler = self._state_handlers.get(self._context.state)
        if not handler:
            return False

        # Execute handler
        new_state = handler(gesture, position)

        # Transition if needed
        if new_state is not None and new_state != self._context.state:
            self._transition_to(new_state, position)

        return True

    def cancel(self) -> None:
        """Cancel current interaction and return to idle."""
        # Rollback any in-progress operations
        if self._context.state in (
            InteractionState.MOVING,
            InteractionState.ROTATING,
            InteractionState.SCALING,
        ):
            self._engine.cancel_transform()

        if self._context.state == InteractionState.DRAWING:
            if self._tool_manager:
                self._tool_manager.cancel_current_operation()

        self._transition_to(InteractionState.IDLE)

    def confirm(self) -> None:
        """Confirm current interaction."""
        if self._context.state in (
            InteractionState.MOVING,
            InteractionState.ROTATING,
            InteractionState.SCALING,
        ):
            self._engine.end_transform()

        if self._context.state == InteractionState.DRAWING:
            if self._tool_manager:
                pos = self._context.current_position or (0, 0)
                self._tool_manager.finish(*pos)

        self._transition_to(InteractionState.IDLE)

    def _transition_to(
        self,
        new_state: InteractionState,
        position: tuple[float, float] | None = None,
    ) -> None:
        """Transition to a new state.

        Args:
            new_state: State to transition to.
            position: Starting position for new state.
        """
        old_state = self._context.state

        # Reset context
        self._context = InteractionContext(
            state=new_state,
            start_position=position,
            current_position=position,
        )

        # Notify handlers
        for handler in self._state_change_handlers:
            handler(old_state, new_state)

    def _handle_idle(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
    ) -> InteractionState | None:
        """Handle gesture in idle state."""
        from core.vision.gesture_recognizer import GestureType

        engine_mode = self._engine.mode

        # Check engine mode to determine behavior
        from core.blueprint.engine import InteractionMode

        if engine_mode == InteractionMode.SELECT:
            if gesture == GestureType.POINTING:
                self._engine.select_at_point(*position)
                return InteractionState.SELECTING

        elif engine_mode == InteractionMode.TRANSLATE:
            if gesture == GestureType.CLOSED_FIST:
                self._engine.begin_translate()
                return InteractionState.MOVING

        elif engine_mode == InteractionMode.ROTATE:
            if gesture == GestureType.CLOSED_FIST:
                self._engine.begin_rotate()
                return InteractionState.ROTATING

        elif engine_mode == InteractionMode.SCALE:
            if gesture == GestureType.PINCH:
                self._engine.begin_scale()
                return InteractionState.SCALING

        elif engine_mode == InteractionMode.DRAW:
            if gesture == GestureType.POINTING:
                if self._tool_manager:
                    self._tool_manager.start_draw(*position)
                return InteractionState.DRAWING

        elif engine_mode == InteractionMode.PAN:
            if gesture in (GestureType.OPEN_PALM, GestureType.CLOSED_FIST):
                return InteractionState.PANNING

        # Global gestures
        if gesture == GestureType.PEACE:
            self._engine.undo()
        elif gesture == GestureType.OK_SIGN:
            self._engine.toggle_snap_to_grid()
        elif gesture == GestureType.CALL_ME:
            self._engine.toggle_grid_visible()

        return None

    def _handle_selecting(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
    ) -> InteractionState | None:
        """Handle gesture in selecting state."""
        from core.vision.gesture_recognizer import GestureType

        if gesture == GestureType.OPEN_PALM:
            self._engine.deselect_all()
            return InteractionState.IDLE

        if gesture == GestureType.POINTING:
            # Continue selection
            self._engine.select_at_point(*position, add=True)
            return None

        if gesture == GestureType.CLOSED_FIST:
            # Switch to moving selected
            if self._engine.has_selection():
                self._engine.begin_translate()
                return InteractionState.MOVING

        return InteractionState.IDLE

    def _handle_moving(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
    ) -> InteractionState | None:
        """Handle gesture in moving state."""
        from core.vision.gesture_recognizer import GestureType

        if gesture == GestureType.THUMBS_UP:
            self._engine.end_transform()
            return InteractionState.IDLE

        if gesture == GestureType.THUMBS_DOWN:
            self._engine.cancel_transform()
            return InteractionState.IDLE

        if gesture == GestureType.CLOSED_FIST:
            # Continue moving
            start = self._context.start_position or position
            delta_x = position[0] - start[0]
            delta_y = position[1] - start[1]
            self._engine.update_transform(dx=delta_x, dy=delta_y)

        return None

    def _handle_rotating(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
    ) -> InteractionState | None:
        """Handle gesture in rotating state."""
        from core.vision.gesture_recognizer import GestureType
        import math

        if gesture == GestureType.THUMBS_UP:
            self._engine.end_transform()
            return InteractionState.IDLE

        if gesture == GestureType.THUMBS_DOWN:
            self._engine.cancel_transform()
            return InteractionState.IDLE

        if gesture == GestureType.CLOSED_FIST:
            # Calculate rotation from center
            start = self._context.start_position or position
            center = self._get_selection_center()
            if center:
                angle1 = math.atan2(start[1] - center[1], start[0] - center[0])
                angle2 = math.atan2(position[1] - center[1], position[0] - center[0])
                delta_angle = math.degrees(angle2 - angle1)
                self._engine.update_transform(rotation=delta_angle)

        return None

    def _handle_scaling(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
    ) -> InteractionState | None:
        """Handle gesture in scaling state."""
        from core.vision.gesture_recognizer import GestureType

        if gesture == GestureType.THUMBS_UP:
            self._engine.end_transform()
            return InteractionState.IDLE

        if gesture == GestureType.THUMBS_DOWN:
            self._engine.cancel_transform()
            return InteractionState.IDLE

        if gesture == GestureType.PINCH:
            # Calculate scale from pinch distance change
            metadata = self._context.metadata
            if "pinch_distance" in metadata:
                # Would need pinch distance from gesture detector
                pass

        return None

    def _handle_drawing(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
    ) -> InteractionState | None:
        """Handle gesture in drawing state."""
        from core.vision.gesture_recognizer import GestureType

        if gesture == GestureType.THUMBS_UP:
            if self._tool_manager:
                self._tool_manager.finish(*position)
            return InteractionState.IDLE

        if gesture == GestureType.THUMBS_DOWN:
            if self._tool_manager:
                self._tool_manager.cancel_current_operation()
            return InteractionState.IDLE

        if gesture == GestureType.POINTING:
            if self._tool_manager:
                self._tool_manager.continue_draw(*position)

        return None

    def _handle_panning(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
    ) -> InteractionState | None:
        """Handle gesture in panning state."""
        from core.vision.gesture_recognizer import GestureType

        if gesture in (GestureType.OPEN_PALM, GestureType.CLOSED_FIST):
            start = self._context.start_position or position
            delta_x = position[0] - start[0]
            delta_y = position[1] - start[1]
            self._engine.pan(delta_x * 100, delta_y * 100)  # Scale for sensitivity
            self._context.start_position = position  # Update for continuous pan
        else:
            return InteractionState.IDLE

        return None

    def _handle_zooming(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
    ) -> InteractionState | None:
        """Handle gesture in zooming state."""
        from core.vision.gesture_recognizer import GestureType

        if gesture == GestureType.SWIPE_UP:
            self._engine.zoom_in()
        elif gesture == GestureType.SWIPE_DOWN:
            self._engine.zoom_out()
        else:
            return InteractionState.IDLE

        return None

    def _handle_confirming(
        self,
        gesture: "GestureType",
        position: tuple[float, float],
    ) -> InteractionState | None:
        """Handle gesture in confirming state."""
        from core.vision.gesture_recognizer import GestureType

        if gesture == GestureType.THUMBS_UP:
            # Confirm pending action
            self._context.metadata.get("confirm_callback", lambda: None)()
            return InteractionState.IDLE

        if gesture == GestureType.THUMBS_DOWN:
            # Cancel pending action
            self._context.metadata.get("cancel_callback", lambda: None)()
            return InteractionState.IDLE

        return None

    def _get_selection_center(self) -> tuple[float, float] | None:
        """Get center of current selection."""
        bounds = self._engine.get_selection_bounds()
        if bounds:
            return (
                (bounds.min_x + bounds.max_x) / 2,
                (bounds.min_y + bounds.max_y) / 2,
            )
        return None


class GestureSequenceDetector:
    """Detects gesture sequences for complex commands.

    Recognizes patterns like:
    - Double-tap: POINTING + POINTING in quick succession
    - Long hold: CLOSED_FIST held for > 1 second
    - Swipe sequences: SWIPE_LEFT + SWIPE_UP for diagonal
    """

    def __init__(self, timeout: float = 0.5) -> None:
        """Initialize sequence detector.

        Args:
            timeout: Maximum time between gestures in sequence.
        """
        self._timeout = timeout
        self._sequence: list[tuple["GestureType", float]] = []

        # Registered sequences and handlers
        self._patterns: dict[
            tuple["GestureType", ...],
            Callable[[], None],
        ] = {}

    def register_pattern(
        self,
        pattern: tuple["GestureType", ...],
        handler: Callable[[], None],
    ) -> None:
        """Register a gesture pattern.

        Args:
            pattern: Tuple of gestures in sequence.
            handler: Callback when pattern is detected.
        """
        self._patterns[pattern] = handler

    def on_gesture(
        self,
        gesture: "GestureType",
        timestamp: float,
    ) -> bool:
        """Record a gesture and check for pattern matches.

        Args:
            gesture: Gesture that occurred.
            timestamp: Time of gesture.

        Returns:
            True if a pattern was matched.
        """
        # Remove expired gestures
        self._sequence = [
            (g, t)
            for g, t in self._sequence
            if timestamp - t < self._timeout
        ]

        # Add new gesture
        self._sequence.append((gesture, timestamp))

        # Check patterns
        gestures = tuple(g for g, _ in self._sequence)

        for pattern, handler in self._patterns.items():
            if gestures[-len(pattern):] == pattern:
                handler()
                self._sequence.clear()
                return True

        return False

    def clear(self) -> None:
        """Clear current sequence."""
        self._sequence.clear()
