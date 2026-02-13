"""Tool for transforming blueprint components.

Provides transform operations including translate, rotate, and scale.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from core.base_tool import BaseTool, ToolResult

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine


class BlueprintTransformTool(BaseTool):
    """Tool for transforming blueprint components.

    Allows moving, rotating, and scaling of components with
    support for constraints and snapping.
    """

    def __init__(self, engine: "BlueprintEngine | None" = None) -> None:
        """Initialize transform tool.

        Args:
            engine: Blueprint engine instance.
        """
        self._engine = engine

    @property
    def name(self) -> str:
        return "blueprint_transform"

    @property
    def description(self) -> str:
        return (
            "Transform blueprint components. "
            "Actions: translate, rotate, scale, align, distribute."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["translate", "rotate", "scale", "align", "distribute", "reset"],
                    "description": "Transform action to perform",
                },
                "component_id": {
                    "type": "string",
                    "description": "Target component ID (or 'selected' for current selection)",
                },
                "x": {
                    "type": "number",
                    "description": "X offset for translate, or X scale factor",
                },
                "y": {
                    "type": "number",
                    "description": "Y offset for translate, or Y scale factor",
                },
                "z": {
                    "type": "number",
                    "description": "Z offset for translate, or Z scale factor",
                },
                "angle": {
                    "type": "number",
                    "description": "Rotation angle in degrees",
                },
                "axis": {
                    "type": "string",
                    "enum": ["x", "y", "z"],
                    "description": "Rotation axis",
                },
                "uniform": {
                    "type": "boolean",
                    "description": "Uniform scaling (use x value for all axes)",
                },
                "alignment": {
                    "type": "string",
                    "enum": [
                        "left",
                        "center_h",
                        "right",
                        "top",
                        "center_v",
                        "bottom",
                    ],
                    "description": "Alignment direction",
                },
                "distribution": {
                    "type": "string",
                    "enum": ["horizontal", "vertical"],
                    "description": "Distribution direction",
                },
                "snap": {
                    "type": "boolean",
                    "description": "Enable grid snapping",
                },
            },
            "required": ["action"],
        }

    def set_engine(self, engine: "BlueprintEngine") -> None:
        """Set the blueprint engine reference."""
        self._engine = engine

    def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the transform tool."""
        if not self._engine:
            return ToolResult.fail(
                "Blueprint engine not initialized.",
                error_type="engine_not_ready",
            )

        action = kwargs.get("action", "translate")
        start_time = time.time()

        try:
            handlers = {
                "translate": self._translate,
                "rotate": self._rotate,
                "scale": self._scale,
                "align": self._align,
                "distribute": self._distribute,
                "reset": self._reset,
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
                f"Transform failed: {e!s}",
                error_type="transform_error",
                error_details={"exception": type(e).__name__},
            )

    def _get_target_ids(self, kwargs: dict[str, Any]) -> list[str]:
        """Get target component IDs."""
        component_id = kwargs.get("component_id", "selected")

        if component_id == "selected":
            return list(self._engine.selected_ids)

        return [component_id]

    def _translate(self, kwargs: dict[str, Any]) -> str:
        """Translate component(s)."""
        target_ids = self._get_target_ids(kwargs)
        dx = kwargs.get("x", 0)
        dy = kwargs.get("y", 0)
        dz = kwargs.get("z", 0)
        snap = kwargs.get("snap", False)

        if not target_ids:
            return "Error: No component selected"

        # Enable snapping if requested
        if snap:
            self._engine.set_snap_enabled(True)

        # Select targets if not already selected
        if target_ids != list(self._engine.selected_ids):
            self._engine.deselect_all()
            for comp_id in target_ids:
                self._engine.select_by_id(comp_id, add=True)

        # Perform translation
        self._engine.begin_translate()
        self._engine.update_transform(dx=dx, dy=dy, dz=dz)
        self._engine.end_transform()

        return f"Translated {len(target_ids)} component(s) by ({dx}, {dy}, {dz})"

    def _rotate(self, kwargs: dict[str, Any]) -> str:
        """Rotate component(s)."""
        target_ids = self._get_target_ids(kwargs)
        angle = kwargs.get("angle", 0)
        axis = kwargs.get("axis", "z")

        if not target_ids:
            return "Error: No component selected"

        # Select targets if not already selected
        if target_ids != list(self._engine.selected_ids):
            self._engine.deselect_all()
            for comp_id in target_ids:
                self._engine.select_by_id(comp_id, add=True)

        # Perform rotation
        self._engine.begin_rotate()

        # Apply rotation based on axis
        rotation_kwargs = {
            "x": {"drx": angle, "dry": 0, "drz": 0},
            "y": {"drx": 0, "dry": angle, "drz": 0},
            "z": {"drx": 0, "dry": 0, "drz": angle},
        }
        self._engine.update_transform(**rotation_kwargs.get(axis, {"drz": angle}))
        self._engine.end_transform()

        return f"Rotated {len(target_ids)} component(s) by {angle}° around {axis}-axis"

    def _scale(self, kwargs: dict[str, Any]) -> str:
        """Scale component(s)."""
        target_ids = self._get_target_ids(kwargs)
        sx = kwargs.get("x", 1.0)
        sy = kwargs.get("y", 1.0)
        sz = kwargs.get("z", 1.0)
        uniform = kwargs.get("uniform", False)

        if uniform:
            sy = sx
            sz = sx

        if not target_ids:
            return "Error: No component selected"

        # Select targets if not already selected
        if target_ids != list(self._engine.selected_ids):
            self._engine.deselect_all()
            for comp_id in target_ids:
                self._engine.select_by_id(comp_id, add=True)

        # Perform scale
        self._engine.begin_scale()
        self._engine.update_transform(sx=sx, sy=sy, sz=sz)
        self._engine.end_transform()

        scale_str = f"{sx}" if uniform else f"({sx}, {sy}, {sz})"
        return f"Scaled {len(target_ids)} component(s) by {scale_str}"

    def _align(self, kwargs: dict[str, Any]) -> str:
        """Align component(s)."""
        target_ids = self._get_target_ids(kwargs)
        alignment = kwargs.get("alignment", "center_h")

        if len(target_ids) < 2:
            return "Error: Align requires at least 2 components"

        # Get bounds of all targets
        bounds_list = []
        for comp_id in target_ids:
            node = self._engine.scene_graph.get_node(comp_id)
            if node and node.bounds:
                bounds_list.append((comp_id, node.bounds))

        if len(bounds_list) < 2:
            return "Error: Could not get bounds for components"

        # Calculate target position based on alignment
        if alignment in ("left", "right", "center_h"):
            # Horizontal alignment
            if alignment == "left":
                target_x = min(b.min_x for _, b in bounds_list)
            elif alignment == "right":
                target_x = max(b.max_x for _, b in bounds_list)
            else:  # center_h
                target_x = sum((b.min_x + b.max_x) / 2 for _, b in bounds_list) / len(
                    bounds_list
                )

            for comp_id, bounds in bounds_list:
                if alignment == "left":
                    dx = target_x - bounds.min_x
                elif alignment == "right":
                    dx = target_x - bounds.max_x
                else:
                    dx = target_x - (bounds.min_x + bounds.max_x) / 2

                self._translate_node(comp_id, dx, 0, 0)

        elif alignment in ("top", "bottom", "center_v"):
            # Vertical alignment
            if alignment == "top":
                target_y = min(b.min_y for _, b in bounds_list)
            elif alignment == "bottom":
                target_y = max(b.max_y for _, b in bounds_list)
            else:  # center_v
                target_y = sum((b.min_y + b.max_y) / 2 for _, b in bounds_list) / len(
                    bounds_list
                )

            for comp_id, bounds in bounds_list:
                if alignment == "top":
                    dy = target_y - bounds.min_y
                elif alignment == "bottom":
                    dy = target_y - bounds.max_y
                else:
                    dy = target_y - (bounds.min_y + bounds.max_y) / 2

                self._translate_node(comp_id, 0, dy, 0)

        return f"Aligned {len(target_ids)} components to {alignment}"

    def _distribute(self, kwargs: dict[str, Any]) -> str:
        """Distribute component(s) evenly."""
        target_ids = self._get_target_ids(kwargs)
        distribution = kwargs.get("distribution", "horizontal")

        if len(target_ids) < 3:
            return "Error: Distribute requires at least 3 components"

        # Get bounds and centers
        items = []
        for comp_id in target_ids:
            node = self._engine.scene_graph.get_node(comp_id)
            if node and node.bounds:
                center_x = (node.bounds.min_x + node.bounds.max_x) / 2
                center_y = (node.bounds.min_y + node.bounds.max_y) / 2
                items.append((comp_id, center_x, center_y, node.bounds))

        if len(items) < 3:
            return "Error: Could not get bounds for components"

        # Sort by position
        if distribution == "horizontal":
            items.sort(key=lambda x: x[1])  # Sort by center_x
        else:
            items.sort(key=lambda x: x[2])  # Sort by center_y

        # Calculate spacing
        if distribution == "horizontal":
            start = items[0][1]
            end = items[-1][1]
        else:
            start = items[0][2]
            end = items[-1][2]

        spacing = (end - start) / (len(items) - 1)

        # Apply distribution (skip first and last)
        for i, (comp_id, cx, cy, bounds) in enumerate(items[1:-1], 1):
            if distribution == "horizontal":
                target_pos = start + spacing * i
                dx = target_pos - cx
                self._translate_node(comp_id, dx, 0, 0)
            else:
                target_pos = start + spacing * i
                dy = target_pos - cy
                self._translate_node(comp_id, 0, dy, 0)

        return f"Distributed {len(items)} components {distribution}ly"

    def _reset(self, kwargs: dict[str, Any]) -> str:
        """Reset component transform to identity."""
        target_ids = self._get_target_ids(kwargs)

        if not target_ids:
            return "Error: No component selected"

        reset_count = 0
        for comp_id in target_ids:
            node = self._engine.scene_graph.get_node(comp_id)
            if node and node.transform:
                node.transform.x = 0
                node.transform.y = 0
                node.transform.z = 0
                node.transform.rx = 0
                node.transform.ry = 0
                node.transform.rz = 0
                node.transform.sx = 1
                node.transform.sy = 1
                node.transform.sz = 1
                reset_count += 1

        return f"Reset transform on {reset_count} component(s)"

    def _translate_node(
        self, node_id: str, dx: float, dy: float, dz: float
    ) -> None:
        """Translate a single node."""
        node = self._engine.scene_graph.get_node(node_id)
        if node and node.transform:
            node.transform.x += dx
            node.transform.y += dy
            node.transform.z += dz
