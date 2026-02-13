"""Tool for editing blueprint component properties.

Provides component editing capabilities including property modification,
metadata updates, and structural changes.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from core.base_tool import BaseTool, ToolResult

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine


class BlueprintEditTool(BaseTool):
    """Tool for editing blueprint components.

    Allows modification of component properties, materials, dimensions,
    and metadata.
    """

    def __init__(self, engine: "BlueprintEngine | None" = None) -> None:
        """Initialize edit tool.

        Args:
            engine: Blueprint engine instance.
        """
        self._engine = engine

    @property
    def name(self) -> str:
        return "blueprint_edit"

    @property
    def description(self) -> str:
        return (
            "Edit blueprint components. "
            "Actions: set_property, set_material, set_dimension, rename, delete, duplicate."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "set_property",
                        "set_material",
                        "set_dimension",
                        "rename",
                        "delete",
                        "duplicate",
                        "list",
                        "get_info",
                    ],
                    "description": "Edit action to perform",
                },
                "component_id": {
                    "type": "string",
                    "description": "Target component ID (or 'selected' for current selection)",
                },
                "property_name": {
                    "type": "string",
                    "description": "Property name to modify",
                },
                "property_value": {
                    "type": "string",
                    "description": "New property value",
                },
                "material": {
                    "type": "string",
                    "description": "Material name (for set_material)",
                },
                "dimension": {
                    "type": "string",
                    "enum": ["width", "height", "depth", "radius", "thickness"],
                    "description": "Dimension to modify",
                },
                "value": {
                    "type": "number",
                    "description": "Numeric value for dimension",
                },
                "unit": {
                    "type": "string",
                    "enum": ["mm", "cm", "m", "in", "ft"],
                    "description": "Unit for dimension value",
                },
                "new_name": {
                    "type": "string",
                    "description": "New name (for rename action)",
                },
            },
            "required": ["action"],
        }

    def set_engine(self, engine: "BlueprintEngine") -> None:
        """Set the blueprint engine reference."""
        self._engine = engine

    def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the edit tool."""
        if not self._engine:
            return ToolResult.fail(
                "Blueprint engine not initialized.",
                error_type="engine_not_ready",
            )

        action = kwargs.get("action", "list")
        start_time = time.time()

        try:
            handlers = {
                "set_property": self._set_property,
                "set_material": self._set_material,
                "set_dimension": self._set_dimension,
                "rename": self._rename,
                "delete": self._delete,
                "duplicate": self._duplicate,
                "list": self._list_components,
                "get_info": self._get_info,
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
                f"Edit failed: {e!s}",
                error_type="edit_error",
                error_details={"exception": type(e).__name__},
            )

    def _get_target_ids(self, kwargs: dict[str, Any]) -> list[str]:
        """Get target component IDs."""
        component_id = kwargs.get("component_id", "selected")

        if component_id == "selected":
            return list(self._engine.selected_ids)

        return [component_id]

    def _set_property(self, kwargs: dict[str, Any]) -> str:
        """Set a component property."""
        target_ids = self._get_target_ids(kwargs)
        prop_name = kwargs.get("property_name")
        prop_value = kwargs.get("property_value")

        if not prop_name:
            return "Error: property_name is required"

        if not target_ids:
            return "Error: No component selected"

        modified = 0
        for comp_id in target_ids:
            node = self._engine.scene_graph.get_node(comp_id)
            if node and node.metadata is not None:
                node.metadata[prop_name] = prop_value
                modified += 1

        return f"Set {prop_name}={prop_value} on {modified} component(s)"

    def _set_material(self, kwargs: dict[str, Any]) -> str:
        """Set component material."""
        target_ids = self._get_target_ids(kwargs)
        material = kwargs.get("material")

        if not material:
            return "Error: material is required"

        if not target_ids:
            return "Error: No component selected"

        modified = 0
        blueprint = self._engine.current_blueprint
        if blueprint:
            for comp_id in target_ids:
                for comp in blueprint.components:
                    if comp.id == comp_id:
                        comp.material = material
                        modified += 1
                        break

        return f"Set material to '{material}' on {modified} component(s)"

    def _set_dimension(self, kwargs: dict[str, Any]) -> str:
        """Set component dimension."""
        target_ids = self._get_target_ids(kwargs)
        dimension = kwargs.get("dimension")
        value = kwargs.get("value")
        unit = kwargs.get("unit", "mm")

        if not dimension or value is None:
            return "Error: dimension and value are required"

        if not target_ids:
            return "Error: No component selected"

        modified = 0
        blueprint = self._engine.current_blueprint
        if blueprint:
            for comp_id in target_ids:
                for comp in blueprint.components:
                    if comp.id == comp_id:
                        if comp.dimensions:
                            setattr(comp.dimensions, dimension, value)
                            comp.dimensions.unit = unit
                            modified += 1
                        break

        return f"Set {dimension}={value}{unit} on {modified} component(s)"

    def _rename(self, kwargs: dict[str, Any]) -> str:
        """Rename a component."""
        target_ids = self._get_target_ids(kwargs)
        new_name = kwargs.get("new_name")

        if not new_name:
            return "Error: new_name is required"

        if len(target_ids) != 1:
            return "Error: Rename requires exactly one component"

        comp_id = target_ids[0]
        node = self._engine.scene_graph.get_node(comp_id)
        if node:
            old_name = node.name
            node.name = new_name
            return f"Renamed '{old_name}' to '{new_name}'"

        return f"Component not found: {comp_id}"

    def _delete(self, kwargs: dict[str, Any]) -> str:
        """Delete component(s)."""
        target_ids = self._get_target_ids(kwargs)

        if not target_ids:
            return "Error: No component selected"

        deleted = 0
        for comp_id in target_ids:
            if self._engine.remove_component(comp_id):
                deleted += 1

        return f"Deleted {deleted} component(s)"

    def _duplicate(self, kwargs: dict[str, Any]) -> str:
        """Duplicate component(s)."""
        target_ids = self._get_target_ids(kwargs)

        if not target_ids:
            return "Error: No component selected"

        duplicated = []
        for comp_id in target_ids:
            new_id = self._engine.duplicate_component(comp_id)
            if new_id:
                duplicated.append(new_id)

        return f"Duplicated {len(duplicated)} component(s): {', '.join(duplicated)}"

    def _list_components(self, kwargs: dict[str, Any]) -> str:
        """List all components."""
        if not self._engine.scene_graph:
            return "No blueprint loaded"

        nodes = self._engine.scene_graph.get_all_nodes()
        if not nodes:
            return "No components in blueprint"

        lines = ["Components:"]
        for node in nodes:
            selected = "* " if node.id in self._engine.selected_ids else "  "
            lines.append(f"{selected}{node.id}: {node.name}")

        return "\n".join(lines)

    def _get_info(self, kwargs: dict[str, Any]) -> str:
        """Get component information."""
        target_ids = self._get_target_ids(kwargs)

        if not target_ids:
            return "Error: No component selected"

        lines = []
        for comp_id in target_ids:
            node = self._engine.scene_graph.get_node(comp_id)
            if node:
                lines.append(f"Component: {node.name} ({node.id})")
                lines.append(f"  Type: {node.node_type}")

                if node.transform:
                    t = node.transform
                    lines.append(f"  Position: ({t.x:.2f}, {t.y:.2f}, {t.z:.2f})")
                    lines.append(f"  Rotation: ({t.rx:.1f}°, {t.ry:.1f}°, {t.rz:.1f}°)")
                    lines.append(f"  Scale: ({t.sx:.2f}, {t.sy:.2f}, {t.sz:.2f})")

                if node.bounds:
                    b = node.bounds
                    lines.append(
                        f"  Bounds: ({b.min_x:.2f}, {b.min_y:.2f}) to "
                        f"({b.max_x:.2f}, {b.max_y:.2f})"
                    )

                if node.metadata:
                    lines.append("  Metadata:")
                    for k, v in node.metadata.items():
                        lines.append(f"    {k}: {v}")

                lines.append("")

        return "\n".join(lines) if lines else "No component info available"
