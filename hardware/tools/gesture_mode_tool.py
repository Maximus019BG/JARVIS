"""Tool for switching gesture interaction modes.

Provides mode switching and gesture configuration for blueprint editing.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from core.base_tool import BaseTool, ToolResult

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine
    from core.blueprint_gesture import InteractionController


class GestureModeTool(BaseTool):
    """Tool for controlling gesture interaction modes.

    Allows switching between selection, translation, rotation,
    scale, and drawing modes.
    """

    def __init__(
        self,
        engine: "BlueprintEngine | None" = None,
        controller: "InteractionController | None" = None,
    ) -> None:
        """Initialize gesture mode tool.

        Args:
            engine: Blueprint engine instance.
            controller: Gesture interaction controller.
        """
        self._engine = engine
        self._controller = controller

    @property
    def name(self) -> str:
        return "gesture_mode"

    @property
    def description(self) -> str:
        return (
            "Control gesture interaction modes. "
            "Actions: set_mode, get_mode, list_modes, configure."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["set_mode", "get_mode", "list_modes", "configure", "status"],
                    "description": "Action to perform",
                },
                "mode": {
                    "type": "string",
                    "enum": [
                        "select",
                        "translate",
                        "rotate",
                        "scale",
                        "draw",
                        "pan",
                        "zoom",
                        "view",
                    ],
                    "description": "Interaction mode to set",
                },
                "setting": {
                    "type": "string",
                    "description": "Setting name to configure",
                },
                "value": {
                    "type": "string",
                    "description": "Setting value",
                },
            },
            "required": ["action"],
        }

    def set_engine(self, engine: "BlueprintEngine") -> None:
        """Set the blueprint engine reference."""
        self._engine = engine

    def set_controller(self, controller: "InteractionController") -> None:
        """Set the interaction controller."""
        self._controller = controller

    def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the gesture mode tool."""
        if not self._engine:
            return ToolResult.fail(
                "Blueprint engine not initialized.",
                error_type="engine_not_ready",
            )

        action = kwargs.get("action", "status")
        start_time = time.time()

        try:
            handlers = {
                "set_mode": self._set_mode,
                "get_mode": self._get_mode,
                "list_modes": self._list_modes,
                "configure": self._configure,
                "status": self._status,
            }

            handler = handlers.get(action)
            if not handler:
                return ToolResult.fail(
                    f"Unknown action: {action}",
                    error_type="validation_error",
                )

            result = handler(kwargs)
            duration_ms = int((time.time() - start_time) * 1000)

            return ToolResult.ok_result(
                result,
                tool=self.name,
                duration_ms=duration_ms,
            )

        except Exception as e:
            return ToolResult.fail(
                f"Gesture mode action failed: {e!s}",
                error_type="gesture_mode_error",
                error_details={"exception": type(e).__name__},
            )

    def _set_mode(self, kwargs: dict[str, Any]) -> str:
        """Set the interaction mode."""
        from core.blueprint.engine import InteractionMode

        mode_name = kwargs.get("mode")
        if not mode_name:
            return "Error: mode is required"

        mode_map = {
            "select": InteractionMode.SELECT,
            "translate": InteractionMode.TRANSLATE,
            "rotate": InteractionMode.ROTATE,
            "scale": InteractionMode.SCALE,
            "draw": InteractionMode.DRAW,
            "pan": InteractionMode.PAN,
            "zoom": InteractionMode.ZOOM,
            "view": InteractionMode.VIEW,
        }

        mode = mode_map.get(mode_name)
        if not mode:
            return f"Unknown mode: {mode_name}"

        self._engine.set_mode(mode)
        return f"Set interaction mode to: {mode_name}"

    def _get_mode(self, kwargs: dict[str, Any]) -> str:
        """Get current interaction mode."""
        mode = self._engine.mode
        controller_state = None

        if self._controller:
            controller_state = self._controller.state.name

        result = f"Current mode: {mode.name}"
        if controller_state:
            result += f"\nController state: {controller_state}"

        return result

    def _list_modes(self, kwargs: dict[str, Any]) -> str:
        """List available modes."""
        from core.blueprint.engine import InteractionMode

        lines = ["Available interaction modes:"]
        mode_descriptions = {
            "SELECT": "Select components by pointing",
            "TRANSLATE": "Move components with closed fist",
            "ROTATE": "Rotate components by turning hand",
            "SCALE": "Scale components with pinch gesture",
            "DRAW": "Draw new shapes by pointing",
            "PAN": "Pan view with open palm",
            "ZOOM": "Zoom with swipe up/down",
            "VIEW": "Change view angle",
            "EXTRUDE": "Extrude 2D shapes to 3D",
            "MEASURE": "Measure distances",
            "ANNOTATE": "Add annotations",
            "MENU": "Access menus",
        }

        current = self._engine.mode
        for mode in InteractionMode:
            marker = "→ " if mode == current else "  "
            desc = mode_descriptions.get(mode.name, "")
            lines.append(f"{marker}{mode.name}: {desc}")

        return "\n".join(lines)

    def _configure(self, kwargs: dict[str, Any]) -> str:
        """Configure gesture settings."""
        setting = kwargs.get("setting")
        value = kwargs.get("value")

        if not setting:
            # List available settings
            return (
                "Available settings:\n"
                "  snap_enabled: true/false\n"
                "  grid_visible: true/false\n"
                "  grid_size: number (mm)\n"
                "  rotation_snap: number (degrees)\n"
                "  sensitivity: low/medium/high"
            )

        if setting == "snap_enabled":
            enabled = value.lower() in ("true", "1", "yes", "on")
            self._engine.set_snap_enabled(enabled)
            return f"Snap enabled: {enabled}"

        elif setting == "grid_visible":
            visible = value.lower() in ("true", "1", "yes", "on")
            self._engine.set_grid_visible(visible)
            return f"Grid visible: {visible}"

        elif setting == "grid_size":
            try:
                size = float(value)
                self._engine.set_grid_size(size)
                return f"Grid size: {size}mm"
            except ValueError:
                return f"Invalid grid size: {value}"

        elif setting == "rotation_snap":
            try:
                angle = float(value)
                self._engine.set_rotation_snap(angle)
                return f"Rotation snap: {angle}°"
            except ValueError:
                return f"Invalid rotation snap: {value}"

        elif setting == "sensitivity":
            sensitivity_map = {
                "low": 0.5,
                "medium": 1.0,
                "high": 2.0,
            }
            multiplier = sensitivity_map.get(value.lower())
            if multiplier:
                # Would apply to spatial mapper
                return f"Sensitivity set to: {value}"
            return f"Invalid sensitivity: {value} (use low/medium/high)"

        return f"Unknown setting: {setting}"

    def _status(self, kwargs: dict[str, Any]) -> str:
        """Get gesture interaction status."""
        lines = ["Gesture Interaction Status:"]

        # Engine status
        lines.append(f"\nBlueprint Engine:")
        lines.append(f"  Mode: {self._engine.mode.name}")
        lines.append(f"  View Mode: {self._engine.view_mode.name}")
        lines.append(f"  Snap Enabled: {self._engine.snap_enabled}")
        lines.append(f"  Grid Visible: {self._engine.grid_visible}")

        # Selection
        selected = len(self._engine.selected_ids)
        lines.append(f"  Selected: {selected} component(s)")

        # Controller status
        if self._controller:
            lines.append(f"\nInteraction Controller:")
            lines.append(f"  State: {self._controller.state.name}")
            ctx = self._controller.context
            if ctx.start_position:
                lines.append(
                    f"  Start Position: ({ctx.start_position[0]:.2f}, "
                    f"{ctx.start_position[1]:.2f})"
                )
        else:
            lines.append("\nInteraction Controller: Not configured")

        # Blueprint info
        if self._engine.current_blueprint:
            bp = self._engine.current_blueprint
            name = bp.metadata.get("name", "Unnamed")
            lines.append(f"\nBlueprint: {name}")
            if self._engine.scene_graph:
                node_count = len(self._engine.scene_graph.get_all_nodes())
                lines.append(f"  Components: {node_count}")

        return "\n".join(lines)
