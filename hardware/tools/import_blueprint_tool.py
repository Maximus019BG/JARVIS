"""Tool to import and compose blueprints together.

Allows importing an existing .jarvis blueprint into the current blueprint
as a sub-assembly. The imported blueprint becomes a single movable group
within the active blueprint, enabling users to build complex designs from
smaller reusable modules.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.security import SecurityError, get_security_manager


class ImportBlueprintTool(BaseTool):
    """Tool for importing blueprints as sub-assemblies.

    Imports an existing .jarvis blueprint file into the currently active
    blueprint. All imported components are grouped together so they can
    be moved, rotated, and scaled as a single unit.

    This enables a compositing workflow where users create small, focused
    blueprints and combine them into larger assemblies.
    """

    @property
    def name(self) -> str:
        return "import_blueprint"

    @property
    def description(self) -> str:
        return (
            "Imports an existing .jarvis blueprint file into the current "
            "blueprint as a sub-assembly. The imported blueprint is added "
            "as a movable group that can be positioned within the design. "
            "Point to a local .jarvis file path."
        )

    def execute(
        self,
        file_path: str = "",
        position_x: float = 0.0,
        position_y: float = 0.0,
        position_z: float = 0.0,
        group_name: str = "",
    ) -> ToolResult:
        if not file_path:
            return ToolResult.fail(
                "Please specify a file path to the .jarvis blueprint to import.",
                error_type="ValidationError",
            )

        source_path = Path(file_path)
        security = get_security_manager()

        # Try resolving relative to data/blueprints if not absolute
        if not source_path.is_absolute():
            candidate_bp = Path("data/blueprints") / source_path
            candidate_direct = Path(file_path)

            resolved = None
            for candidate in [candidate_bp, candidate_direct]:
                try:
                    r = candidate.resolve()
                    r = security.validate_file_access(r)
                    if r.exists():
                        resolved = r
                        break
                except Exception:
                    continue
        else:
            try:
                resolved = source_path.resolve()
                resolved = security.validate_file_access(resolved)
                if not resolved.exists():
                    resolved = None
            except Exception:
                resolved = None

        if resolved is None:
            return ToolResult.fail(
                f"Blueprint file not found: {file_path}",
                error_type="NotFound",
            )

        # Validate extension
        if resolved.suffix.lower() not in {".jarvis", ".json"}:
            return ToolResult.fail(
                f"Invalid file type: {resolved.suffix}. "
                f"Expected .jarvis or .json file.",
                error_type="ValidationError",
            )

        try:
            with resolved.open("r", encoding="utf-8") as f:
                import_data: dict[str, Any] = json.load(f)
        except json.JSONDecodeError as e:
            return ToolResult.fail(
                f"Invalid JSON in {resolved.name}: {e}",
                error_type="ParseError",
            )

        # Extract imported blueprint info
        import_name = import_data.get("name", resolved.stem)
        import_type = import_data.get("type", "part")
        import_components = import_data.get("components", [])
        import_connections = import_data.get("connections", [])
        import_materials = import_data.get("materials", [])

        if not group_name:
            group_name = f"imported_{import_name}"

        # Generate a unique group ID and prefix for all imported components
        group_id = f"group_{uuid.uuid4().hex[:8]}"
        prefix = f"{group_id}_"

        # Re-ID all imported components to prevent collisions
        id_mapping: dict[str, str] = {}
        rewritten_components: list[dict[str, Any]] = []

        for comp in import_components:
            old_id = comp.get("id", "")
            new_id = f"{prefix}{old_id}"
            id_mapping[old_id] = new_id

            new_comp = dict(comp)
            new_comp["id"] = new_id

            # Offset position by import position
            if "specifications" in new_comp and "dimensions" in new_comp.get(
                "specifications", {}
            ):
                pass  # Keep internal dimensions as-is

            rewritten_components.append(new_comp)

        # Rewrite connections with new IDs
        rewritten_connections: list[dict[str, Any]] = []
        for conn in import_connections:
            new_conn = dict(conn)
            from_id = conn.get("from", conn.get("from_id", ""))
            to_id = conn.get("to", conn.get("to_id", ""))
            new_conn["from"] = id_mapping.get(from_id, from_id)
            new_conn["to"] = id_mapping.get(to_id, to_id)
            rewritten_connections.append(new_conn)

        # Build the import group envelope
        import_group = {
            "id": group_id,
            "name": group_name,
            "type": "import_group",
            "source_file": str(resolved),
            "source_name": import_name,
            "source_type": import_type,
            "position": {
                "x": position_x,
                "y": position_y,
                "z": position_z,
            },
            "components": rewritten_components,
            "connections": rewritten_connections,
            "materials": import_materials,
            "locked": False,
            "quantity": 1,
            "specifications": {
                "imported_from": str(resolved),
                "original_component_count": len(import_components),
            },
        }

        return ToolResult.ok_result(
            f"Blueprint '{import_name}' imported as group '{group_name}' "
            f"({len(import_components)} components, "
            f"{len(import_connections)} connections). "
            f"You can move, rotate, and scale it as a single unit.",
            import_group=import_group,
            group_id=group_id,
            group_name=group_name,
            source_name=import_name,
            component_count=len(import_components),
            connection_count=len(import_connections),
            position={"x": position_x, "y": position_y, "z": position_z},
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": (
                        "Path to the .jarvis blueprint file to import. "
                        "Can be a filename in data/blueprints/ or an "
                        "absolute path to a local file."
                    ),
                },
                "position_x": {
                    "type": "number",
                    "description": "X position to place the imported blueprint (default: 0)",
                },
                "position_y": {
                    "type": "number",
                    "description": "Y position to place the imported blueprint (default: 0)",
                },
                "position_z": {
                    "type": "number",
                    "description": "Z position to place the imported blueprint (default: 0)",
                },
                "group_name": {
                    "type": "string",
                    "description": (
                        "Optional name for the imported group. "
                        "Defaults to 'imported_<blueprint_name>'."
                    ),
                },
            },
            "required": ["file_path"],
        }
