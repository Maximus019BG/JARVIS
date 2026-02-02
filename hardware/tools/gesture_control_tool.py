"""Tool to enable/disable gesture control and map gestures to actions."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from core.base_tool import BaseTool, ToolResult
from core.vision.gesture_recognizer import GestureType

if TYPE_CHECKING:
    from core.vision import VisionService


class GestureControlTool(BaseTool):
    """Tool for managing gesture-based control.

    Allows enabling, disabling, and configuring gesture recognition.
    Can map gestures to JARVIS commands.
    """

    def __init__(self, vision_service: "VisionService | None" = None) -> None:
        self._vision_service = vision_service
        self._gesture_mappings: dict[str, str] = {
            # Default gesture-to-command mappings
            "thumbs_up": "confirm",
            "thumbs_down": "cancel",
            "open_palm": "stop",
            "pointing": "select",
            "peace": "help",
            "closed_fist": "undo",
            "pinch": "zoom",
            "ok_sign": "ok",
            "swipe_left": "back",
            "swipe_right": "forward",
            "swipe_up": "scroll_up",
            "swipe_down": "scroll_down",
        }
        self._enabled = False

    @property
    def name(self) -> str:
        return "gesture_control"

    @property
    def description(self) -> str:
        return (
            "Enable, disable, or configure gesture-based control. "
            "Allows mapping hand gestures to JARVIS actions. "
            "Actions: enable, disable, status, map, unmap, list"
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["enable", "disable", "status", "map", "unmap", "list"],
                    "description": "Action to perform",
                },
                "gesture": {
                    "type": "string",
                    "description": "Gesture name (e.g., thumbs_up, pointing, peace)",
                },
                "command": {
                    "type": "string",
                    "description": "Command to map to the gesture",
                },
            },
            "required": ["action"],
        }

    def set_vision_service(self, service: "VisionService") -> None:
        """Set the vision service reference."""
        self._vision_service = service

    def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the gesture control tool."""
        action = kwargs.get("action", "status")
        gesture = kwargs.get("gesture")
        command = kwargs.get("command")

        if action == "enable":
            return self._enable()

        if action == "disable":
            return self._disable()

        if action == "status":
            return self._status()

        if action == "map":
            if not gesture or not command:
                return ToolResult.fail(
                    "Both 'gesture' and 'command' are required for mapping.",
                    error_type="validation_error",
                )
            return self._map_gesture(gesture, command)

        if action == "unmap":
            if not gesture:
                return ToolResult.fail(
                    "'gesture' is required for unmapping.",
                    error_type="validation_error",
                )
            return self._unmap_gesture(gesture)

        if action == "list":
            return self._list_mappings()

        return ToolResult.fail(
            f"Unknown action: {action}",
            error_type="validation_error",
        )

    def _enable(self) -> ToolResult:
        """Enable gesture control."""
        self._enabled = True
        return ToolResult.ok_result(
            "Gesture control enabled. "
            "Hand gestures will now be recognized and mapped to commands."
        )

    def _disable(self) -> ToolResult:
        """Disable gesture control."""
        self._enabled = False
        return ToolResult.ok_result("Gesture control disabled.")

    def _status(self) -> ToolResult:
        """Get gesture control status."""
        status = "enabled" if self._enabled else "disabled"
        vision_status = "not initialized"

        if self._vision_service:
            vision_status = (
                "running" if self._vision_service.is_running else "stopped"
            )

        mappings_count = len(self._gesture_mappings)

        return ToolResult.ok_result(
            f"Gesture control: {status}\n"
            f"Vision service: {vision_status}\n"
            f"Active mappings: {mappings_count}"
        )

    def _map_gesture(self, gesture: str, command: str) -> ToolResult:
        """Map a gesture to a command."""
        # Validate gesture name
        gesture_lower = gesture.lower()
        valid_gestures = {g.value for g in GestureType if g != GestureType.NONE}

        if gesture_lower not in valid_gestures:
            return ToolResult.fail(
                f"Unknown gesture: {gesture}. "
                f"Valid gestures: {', '.join(sorted(valid_gestures))}",
                error_type="validation_error",
            )

        self._gesture_mappings[gesture_lower] = command
        return ToolResult.ok_result(
            f"Mapped gesture '{gesture_lower}' to command '{command}'."
        )

    def _unmap_gesture(self, gesture: str) -> ToolResult:
        """Remove a gesture mapping."""
        gesture_lower = gesture.lower()

        if gesture_lower not in self._gesture_mappings:
            return ToolResult.fail(
                f"No mapping found for gesture: {gesture}",
                error_type="not_found",
            )

        del self._gesture_mappings[gesture_lower]
        return ToolResult.ok_result(f"Removed mapping for gesture '{gesture_lower}'.")

    def _list_mappings(self) -> ToolResult:
        """List all gesture mappings."""
        if not self._gesture_mappings:
            return ToolResult.ok_result("No gesture mappings configured.")

        lines = ["Current gesture mappings:"]
        for gesture, command in sorted(self._gesture_mappings.items()):
            lines.append(f"  {gesture} → {command}")

        lines.append("")
        lines.append("Available gestures:")
        available = [g.value for g in GestureType if g != GestureType.NONE]
        lines.append(f"  {', '.join(sorted(available))}")

        return ToolResult.ok_result("\n".join(lines))

    def get_command_for_gesture(self, gesture: GestureType) -> str | None:
        """Get the command mapped to a gesture.

        Args:
            gesture: The gesture type.

        Returns:
            The mapped command or None if not mapped.
        """
        return self._gesture_mappings.get(gesture.value)

    @property
    def is_enabled(self) -> bool:
        """Check if gesture control is enabled."""
        return self._enabled
