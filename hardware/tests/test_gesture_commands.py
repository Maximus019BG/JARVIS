"""Tests for gesture command module."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest

from core.blueprint_gesture.gesture_commands import (
    GestureCommand,
    GestureCommandRegistry,
)
from core.blueprint_gesture.spatial_mapping import (
    BlueprintPoint,
    ScreenPoint,
    SpatialMapper,
)
from core.blueprint_gesture.interaction_modes import (
    GestureSequenceDetector,
    InteractionContext,
    InteractionController,
    InteractionState,
)


class TestGestureCommand:
    """Tests for GestureCommand dataclass."""

    def test_command_creation(self) -> None:
        """Test command creation."""
        handler = MagicMock()
        cmd = GestureCommand(
            gesture="POINTING",
            action="select",
            handler=handler,
            description="Select at point",
        )

        assert cmd.gesture == "POINTING"
        assert cmd.action == "select"
        assert cmd.handler is handler
        assert cmd.description == "Select at point"

    def test_command_with_mode(self) -> None:
        """Test command with required mode."""
        handler = MagicMock()
        cmd = GestureCommand(
            gesture="CLOSED_FIST",
            action="translate",
            handler=handler,
            requires_mode="TRANSLATE",
        )

        assert cmd.requires_mode == "TRANSLATE"


class TestGestureCommandRegistry:
    """Tests for GestureCommandRegistry."""

    @pytest.fixture
    def registry(self) -> GestureCommandRegistry:
        """Create a registry."""
        return GestureCommandRegistry()

    def test_registry_creation(self, registry: GestureCommandRegistry) -> None:
        """Test registry creation."""
        assert registry is not None
        # Should have default commands registered
        all_commands = registry.get_all_commands()
        assert len(all_commands) > 0

    def test_get_command_for_gesture(self, registry: GestureCommandRegistry) -> None:
        """Test getting command for gesture."""
        from core.vision.gesture_recognizer import GestureType
        from core.blueprint.engine import InteractionMode
        # Default registry should have POINTING command (with SELECT mode)
        command = registry.get_command(GestureType.POINTING.value, InteractionMode.SELECT.value)
        assert command is not None

    def test_register_custom_command(self, registry: GestureCommandRegistry) -> None:
        """Test registering custom command."""
        handler = MagicMock()
        cmd = GestureCommand(
            gesture="CUSTOM_GESTURE",
            action="custom_action",
            handler=handler,
            description="Custom action",
        )
        registry.register(cmd)

        result = registry.get_command("CUSTOM_GESTURE")
        assert result is not None
        assert result.action == "custom_action"

    def test_unregister_command(self, registry: GestureCommandRegistry) -> None:
        """Test unregistering command."""
        handler = MagicMock()
        cmd = GestureCommand(
            gesture="TEST_GESTURE",
            action="test_action",
            handler=handler,
        )
        registry.register(cmd)

        registry.unregister("TEST_GESTURE", "test_action")

        result = registry.get_command("TEST_GESTURE")
        assert result is None

    def test_get_command(self, registry: GestureCommandRegistry) -> None:
        """Test getting a specific command."""
        handler = MagicMock()
        cmd = GestureCommand(
            gesture="GET_TEST",
            action="get_action",
            handler=handler,
        )
        registry.register(cmd)

        result = registry.get_command("GET_TEST")
        assert result is not None
        assert result.action == "get_action"


class TestScreenPoint:
    """Tests for ScreenPoint."""

    def test_screen_point_creation(self) -> None:
        """Test screen point creation."""
        p = ScreenPoint(x=0.5, y=0.5)
        assert p.x == 0.5
        assert p.y == 0.5

    def test_screen_point_to_tuple(self) -> None:
        """Test conversion to tuple."""
        p = ScreenPoint(x=0.3, y=0.7)
        assert p.to_tuple() == (0.3, 0.7)


class TestBlueprintPoint:
    """Tests for BlueprintPoint."""

    def test_blueprint_point_creation(self) -> None:
        """Test blueprint point creation."""
        p = BlueprintPoint(x=100, y=200, z=50)
        assert p.x == 100
        assert p.y == 200
        assert p.z == 50

    def test_blueprint_point_default_z(self) -> None:
        """Test default z value."""
        p = BlueprintPoint(x=100, y=200)
        assert p.z == 0.0

    def test_blueprint_point_to_tuple(self) -> None:
        """Test conversion to tuple."""
        p = BlueprintPoint(x=10, y=20, z=30)
        assert p.to_tuple() == (10, 20, 30)
        assert p.to_2d_tuple() == (10, 20)


class TestSpatialMapper:
    """Tests for SpatialMapper."""

    @pytest.fixture
    def mapper(self) -> SpatialMapper:
        """Create a spatial mapper."""
        return SpatialMapper(
            screen_width=640,
            screen_height=480,
            flip_x=True,
            flip_y=False,
        )

    @pytest.fixture
    def mock_view(self) -> MagicMock:
        """Create a mock view state."""
        view = MagicMock()
        view.screen_to_world = MagicMock(return_value=(100, 50))
        view.world_to_screen = MagicMock(return_value=(0.5, 0.5))
        return view

    def test_mapper_creation(self, mapper: SpatialMapper) -> None:
        """Test mapper creation."""
        assert mapper is not None
        assert mapper.screen_size == (640, 480)

    def test_screen_to_blueprint(
        self, mapper: SpatialMapper, mock_view: MagicMock
    ) -> None:
        """Test screen to blueprint conversion."""
        result = mapper.screen_to_blueprint(0.5, 0.5, mock_view)

        assert isinstance(result, BlueprintPoint)
        mock_view.screen_to_world.assert_called()

    def test_blueprint_to_screen(
        self, mapper: SpatialMapper, mock_view: MagicMock
    ) -> None:
        """Test blueprint to screen conversion."""
        result = mapper.blueprint_to_screen(100, 50, mock_view)

        assert isinstance(result, ScreenPoint)
        mock_view.world_to_screen.assert_called()

    def test_smoothing(self, mapper: SpatialMapper, mock_view: MagicMock) -> None:
        """Test position smoothing."""
        mapper.smoothing = 0.5

        # First call
        mapper.screen_to_blueprint(0.5, 0.5, mock_view)

        # Second call should be smoothed
        mapper.screen_to_blueprint(0.6, 0.6, mock_view)

        # The call should use smoothed values
        # (verify by checking the internal state)

    def test_reset_smoothing(self, mapper: SpatialMapper) -> None:
        """Test resetting smoothing state."""
        mapper._last_x = 0.5
        mapper._last_y = 0.5

        mapper.reset_smoothing()

        assert mapper._last_x is None
        assert mapper._last_y is None

    def test_pointing_direction(self, mapper: SpatialMapper) -> None:
        """Test getting pointing direction."""
        base = MagicMock()
        base.x = 0.5
        base.y = 0.5

        tip = MagicMock()
        tip.x = 0.6
        tip.y = 0.5

        dx, dy = mapper.get_pointing_direction(base, tip)

        # Should be normalized
        assert abs(dx * dx + dy * dy - 1.0) < 0.01

    def test_pinch_distance(self, mapper: SpatialMapper) -> None:
        """Test getting pinch distance."""
        thumb = MagicMock()
        thumb.x = 0.4
        thumb.y = 0.5

        index = MagicMock()
        index.x = 0.5
        index.y = 0.5

        distance = mapper.get_pinch_distance(thumb, index)

        assert distance == pytest.approx(0.1)


class TestInteractionContext:
    """Tests for InteractionContext."""

    def test_context_defaults(self) -> None:
        """Test context defaults."""
        ctx = InteractionContext()

        assert ctx.state == InteractionState.IDLE
        assert ctx.start_position is None
        assert ctx.current_position is None
        assert ctx.gesture_count == 0

    def test_context_with_values(self) -> None:
        """Test context with values."""
        ctx = InteractionContext(
            state=InteractionState.MOVING,
            start_position=(10, 20),
            current_position=(30, 40),
        )

        assert ctx.state == InteractionState.MOVING
        assert ctx.start_position == (10, 20)


class TestInteractionController:
    """Tests for InteractionController."""

    @pytest.fixture
    def mock_engine(self) -> MagicMock:
        """Create a mock engine."""
        from core.blueprint.engine import InteractionMode

        engine = MagicMock()
        engine.mode = InteractionMode.SELECT
        engine.selected_ids = []
        engine.has_selection.return_value = False
        return engine

    @pytest.fixture
    def controller(self, mock_engine: MagicMock) -> InteractionController:
        """Create an interaction controller."""
        return InteractionController(engine=mock_engine)

    def test_controller_creation(self, controller: InteractionController) -> None:
        """Test controller creation."""
        assert controller is not None
        assert controller.state == InteractionState.IDLE

    def test_on_gesture_pointing(
        self, controller: InteractionController, mock_engine: MagicMock
    ) -> None:
        """Test handling pointing gesture."""
        from core.vision.gesture_recognizer import GestureType

        result = controller.on_gesture(
            GestureType.POINTING,
            position=(0.5, 0.5),
        )

        # In SELECT mode, POINTING should trigger selection
        mock_engine.select_at_point.assert_called()

    def test_cancel(
        self, controller: InteractionController, mock_engine: MagicMock
    ) -> None:
        """Test canceling interaction."""
        controller._context.state = InteractionState.MOVING

        controller.cancel()

        assert controller.state == InteractionState.IDLE
        mock_engine.cancel_transform.assert_called()

    def test_confirm(
        self, controller: InteractionController, mock_engine: MagicMock
    ) -> None:
        """Test confirming interaction."""
        controller._context.state = InteractionState.MOVING

        controller.confirm()

        assert controller.state == InteractionState.IDLE
        mock_engine.end_transform.assert_called()

    def test_state_change_handler(
        self, controller: InteractionController
    ) -> None:
        """Test state change handler."""
        states = []

        def handler(old: InteractionState, new: InteractionState) -> None:
            states.append((old, new))

        controller.on_state_change(handler)
        controller._transition_to(InteractionState.MOVING, (0, 0))

        assert len(states) == 1
        assert states[0] == (InteractionState.IDLE, InteractionState.MOVING)


class TestGestureSequenceDetector:
    """Tests for GestureSequenceDetector."""

    def test_detector_creation(self) -> None:
        """Test detector creation."""
        detector = GestureSequenceDetector(timeout=0.5)
        assert detector is not None

    def test_register_pattern(self) -> None:
        """Test registering pattern."""
        detector = GestureSequenceDetector()
        handler = MagicMock()

        detector.register_pattern(("POINTING", "POINTING"), handler)

        # Pattern should be registered
        assert ("POINTING", "POINTING") in detector._patterns

    def test_pattern_match(self) -> None:
        """Test pattern matching."""
        detector = GestureSequenceDetector(timeout=1.0)
        handler = MagicMock()

        detector.register_pattern(("POINTING", "POINTING"), handler)

        # Simulate double-tap
        detector.on_gesture("POINTING", 0.0)
        matched = detector.on_gesture("POINTING", 0.3)

        assert matched is True
        handler.assert_called_once()

    def test_pattern_timeout(self) -> None:
        """Test pattern timeout."""
        detector = GestureSequenceDetector(timeout=0.5)
        handler = MagicMock()

        detector.register_pattern(("POINTING", "POINTING"), handler)

        # Gestures too far apart
        detector.on_gesture("POINTING", 0.0)
        matched = detector.on_gesture("POINTING", 1.0)  # After timeout

        assert matched is False
        handler.assert_not_called()

    def test_clear_sequence(self) -> None:
        """Test clearing sequence."""
        detector = GestureSequenceDetector()

        detector.on_gesture("POINTING", 0.0)
        detector.clear()

        assert len(detector._sequence) == 0
