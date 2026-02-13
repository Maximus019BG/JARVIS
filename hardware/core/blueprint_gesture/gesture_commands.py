"""Maps gestures to blueprint engine commands.

Provides a registry of gesture-to-action mappings for controlling
the blueprint engine through hand gestures.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable

from app_logging.logger import get_logger

if TYPE_CHECKING:
    from core.vision.gesture_recognizer import GestureType, GestureResult
    from core.blueprint.engine import BlueprintEngine, InteractionMode

logger = get_logger(__name__)


@dataclass
class GestureCommand:
    """A gesture-to-action mapping.

    Defines what action should be taken when a specific gesture
    is detected, optionally in a specific mode.
    """

    gesture: str  # GestureType value
    action: str  # Action identifier
    handler: Callable[[Any, Any], None] | None = None  # (engine, gesture_result) -> None
    description: str = ""
    requires_mode: str | None = None  # InteractionMode value


CommandHandler = Callable[["BlueprintEngine", "GestureResult"], None]


class GestureCommandRegistry:
    """Registry of gesture commands for blueprint interaction.

    Maps gesture types to engine actions, with optional mode-specific
    behavior.

    Usage:
        registry = GestureCommandRegistry()
        registry.register(GestureCommand(
            gesture=GestureType.THUMBS_UP,
            action="confirm",
            handler=lambda e, g: e.save(),
        ))
        registry.handle_gesture(engine, gesture_result)
    """

    def __init__(self) -> None:
        """Initialize gesture command registry."""
        self._commands: dict[str, list[GestureCommand]] = {}
        self._mode_commands: dict[tuple[str, str], GestureCommand] = {}
        self._register_default_commands()

    def _register_default_commands(self) -> None:
        """Register default gesture-to-action mappings."""
        from core.vision.gesture_recognizer import GestureType
        from core.blueprint.engine import InteractionMode

        # Navigation gestures (work in any mode)
        self.register(GestureCommand(
            gesture=GestureType.SWIPE_LEFT.value,
            action="pan_left",
            handler=self._handle_pan_left,
            description="Pan view left",
        ))

        self.register(GestureCommand(
            gesture=GestureType.SWIPE_RIGHT.value,
            action="pan_right",
            handler=self._handle_pan_right,
            description="Pan view right",
        ))

        self.register(GestureCommand(
            gesture=GestureType.SWIPE_UP.value,
            action="zoom_in",
            handler=self._handle_zoom_in,
            description="Zoom in",
        ))

        self.register(GestureCommand(
            gesture=GestureType.SWIPE_DOWN.value,
            action="zoom_out",
            handler=self._handle_zoom_out,
            description="Zoom out",
        ))

        # Selection mode gestures
        self.register(GestureCommand(
            gesture=GestureType.POINTING.value,
            action="select_at_point",
            handler=self._handle_select,
            description="Select component at pointer",
            requires_mode=InteractionMode.SELECT.value,
        ))

        self.register(GestureCommand(
            gesture=GestureType.OPEN_PALM.value,
            action="deselect_all",
            handler=self._handle_deselect,
            description="Clear selection",
        ))

        # Transform gestures
        self.register(GestureCommand(
            gesture=GestureType.CLOSED_FIST.value,
            action="begin_translate",
            handler=self._handle_begin_translate,
            description="Begin moving selection",
            requires_mode=InteractionMode.SELECT.value,
        ))

        self.register(GestureCommand(
            gesture=GestureType.PINCH.value,
            action="begin_scale",
            handler=self._handle_begin_scale,
            description="Begin scaling selection",
            requires_mode=InteractionMode.SELECT.value,
        ))

        # Action gestures
        self.register(GestureCommand(
            gesture=GestureType.THUMBS_UP.value,
            action="confirm",
            handler=self._handle_confirm,
            description="Confirm current action",
        ))

        self.register(GestureCommand(
            gesture=GestureType.THUMBS_DOWN.value,
            action="cancel",
            handler=self._handle_cancel,
            description="Cancel current action",
        ))

        self.register(GestureCommand(
            gesture=GestureType.PEACE.value,
            action="undo",
            handler=self._handle_undo,
            description="Undo last action",
        ))

        self.register(GestureCommand(
            gesture=GestureType.OK_SIGN.value,
            action="toggle_snap",
            handler=self._handle_toggle_snap,
            description="Toggle snap to grid",
        ))

        # Mode switching gestures
        self.register(GestureCommand(
            gesture=GestureType.ROCK.value,
            action="cycle_mode",
            handler=self._handle_cycle_mode,
            description="Cycle interaction mode",
        ))

        self.register(GestureCommand(
            gesture=GestureType.CALL_ME.value,
            action="toggle_grid",
            handler=self._handle_toggle_grid,
            description="Toggle grid display",
        ))

    def register(self, command: GestureCommand) -> None:
        """Register a gesture command.

        Args:
            command: Command to register.
        """
        gesture_key = command.gesture

        if gesture_key not in self._commands:
            self._commands[gesture_key] = []

        self._commands[gesture_key].append(command)

        # Also index by mode if specified
        if command.requires_mode:
            mode_key = (command.gesture, command.requires_mode)
            self._mode_commands[mode_key] = command

        logger.debug(f"Registered gesture command: {command.gesture} -> {command.action}")

    def unregister(self, gesture: str, action: str) -> bool:
        """Unregister a gesture command.

        Args:
            gesture: Gesture type value.
            action: Action identifier.

        Returns:
            True if command was found and removed.
        """
        if gesture not in self._commands:
            return False

        for i, cmd in enumerate(self._commands[gesture]):
            if cmd.action == action:
                self._commands[gesture].pop(i)

                # Also remove from mode index
                if cmd.requires_mode:
                    mode_key = (gesture, cmd.requires_mode)
                    self._mode_commands.pop(mode_key, None)

                return True

        return False

    def get_command(
        self, gesture: str, mode: str | None = None
    ) -> GestureCommand | None:
        """Get command for a gesture, optionally in a specific mode.

        Args:
            gesture: Gesture type value.
            mode: Current interaction mode value.

        Returns:
            Matching command or None.
        """
        # First check mode-specific commands
        if mode:
            mode_key = (gesture, mode)
            if mode_key in self._mode_commands:
                return self._mode_commands[mode_key]

        # Fall back to mode-agnostic commands
        if gesture in self._commands:
            for cmd in self._commands[gesture]:
                if cmd.requires_mode is None:
                    return cmd

        return None

    def get_all_commands(self) -> list[GestureCommand]:
        """Get all registered commands."""
        all_commands: list[GestureCommand] = []
        for commands in self._commands.values():
            all_commands.extend(commands)
        return all_commands

    def handle_gesture(
        self,
        engine: "BlueprintEngine",
        gesture_result: "GestureResult",
    ) -> bool:
        """Handle a detected gesture.

        Args:
            engine: Blueprint engine instance.
            gesture_result: Detected gesture.

        Returns:
            True if gesture was handled.
        """
        gesture_type = gesture_result.gesture.value
        current_mode = engine.mode.value

        command = self.get_command(gesture_type, current_mode)
        if command and command.handler:
            try:
                command.handler(engine, gesture_result)
                logger.debug(f"Handled gesture {gesture_type} with action {command.action}")
                return True
            except Exception as e:
                logger.error(f"Error handling gesture {gesture_type}: {e}")

        return False

    # ---- Default Command Handlers ----

    def _handle_pan_left(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Pan view left."""
        engine.pan_view(-50, 0)

    def _handle_pan_right(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Pan view right."""
        engine.pan_view(50, 0)

    def _handle_zoom_in(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Zoom in."""
        engine.zoom_view(1.25)

    def _handle_zoom_out(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Zoom out."""
        engine.zoom_view(0.8)

    def _handle_select(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Select at gesture location."""
        # Get pointing finger tip position
        hand = gesture.hand
        if hand and hand.landmarks:
            index_tip = hand.landmarks[8]  # INDEX_FINGER_TIP
            engine.select_at_point(index_tip.x, index_tip.y)

    def _handle_deselect(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Clear selection."""
        engine.selection.clear()

    def _handle_begin_translate(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Begin translation of selection."""
        from core.blueprint.engine import InteractionMode
        engine.set_mode(InteractionMode.TRANSLATE)

    def _handle_begin_scale(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Begin scaling of selection."""
        from core.blueprint.engine import InteractionMode
        engine.set_mode(InteractionMode.SCALE)

    def _handle_confirm(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Confirm current action."""
        if engine.transforms.is_transforming:
            engine.end_interactive_transform()
        from core.blueprint.engine import InteractionMode
        engine.set_mode(InteractionMode.SELECT)

    def _handle_cancel(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Cancel current action."""
        if engine.transforms.is_transforming:
            engine.cancel_interactive_transform()
        from core.blueprint.engine import InteractionMode
        engine.set_mode(InteractionMode.SELECT)

    def _handle_undo(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Undo last action."""
        engine.undo()

    def _handle_toggle_snap(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Toggle snap to grid."""
        engine.toggle_snap()

    def _handle_toggle_grid(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Toggle grid display."""
        engine.toggle_grid()

    def _handle_cycle_mode(self, engine: "BlueprintEngine", gesture: "GestureResult") -> None:
        """Cycle through interaction modes."""
        from core.blueprint.engine import InteractionMode

        modes = [
            InteractionMode.SELECT,
            InteractionMode.TRANSLATE,
            InteractionMode.ROTATE,
            InteractionMode.SCALE,
        ]

        try:
            current_idx = modes.index(engine.mode)
            next_idx = (current_idx + 1) % len(modes)
        except ValueError:
            next_idx = 0

        engine.set_mode(modes[next_idx])
