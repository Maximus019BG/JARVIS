"""Tool for editing existing .jarvis blueprints.

File-based edit tool that loads the blueprint JSON, applies modifications,
saves back, and signals the TUI engine to reload.  No live engine instance
is required, so the tool can be registered at startup like any other tool.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.security import SecurityError, get_security_manager


def _compute_hash(data: dict[str, Any]) -> str:
    """Compute a SHA-256 content hash for change detection."""
    content_str = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(content_str.encode()).hexdigest()


def _resolve_blueprint_path(blueprint_ref: str) -> Path | None:
    """Resolve a blueprint reference to an absolute file path.

    Accepts an absolute path, a relative path, or just a name (we search
    ``data/blueprints/`` for ``<name>.jarvis``).
    """
    p = Path(blueprint_ref)

    if p.is_absolute() and p.exists():
        return p

    # Try as-is (relative to cwd)
    if p.exists():
        return p.resolve()

    # Try inside data/blueprints/
    bp_dir = Path("data") / "blueprints"
    candidate = bp_dir / p
    if candidate.exists():
        return candidate.resolve()

    # Try by name (append .jarvis)
    if not p.suffix:
        candidate = bp_dir / f"{blueprint_ref}.jarvis"
        if candidate.exists():
            return candidate.resolve()

    return None


class BlueprintEditTool(BaseTool):
    """Edit an existing .jarvis blueprint on disk.

    Supports adding / removing / modifying components and connections,
    changing blueprint-level metadata (name, dimensions, notes, tags),
    and listing current contents.
    """

    @property
    def name(self) -> str:
        return "edit_blueprint"

    @property
    def description(self) -> str:
        return (
            "Edit an existing .jarvis blueprint.  "
            "Actions: add_component, remove_component, modify_component, "
            "add_connection, remove_connection, set_dimensions, "
            "set_name, add_note, add_tag, list."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "blueprint_path": {
                    "type": "string",
                    "description": (
                        "Path or name of the blueprint to edit.  "
                        "Can be an absolute path, a relative path, "
                        "or just the blueprint name (without .jarvis)."
                    ),
                },
                "action": {
                    "type": "string",
                    "enum": [
                        "add_component",
                        "remove_component",
                        "modify_component",
                        "add_connection",
                        "remove_connection",
                        "set_dimensions",
                        "set_name",
                        "add_note",
                        "add_tag",
                        "list",
                    ],
                    "description": "Edit action to perform on the blueprint.",
                },
                "component": {
                    "type": "object",
                    "description": (
                        "Component object for add_component / modify_component.  "
                        "Must include 'id' and 'name'.  Optional: type, position "
                        "(x/y/z dict), rotation, dimensions, material, quantity, "
                        "specifications, children."
                    ),
                },
                "component_id": {
                    "type": "string",
                    "description": (
                        "ID of the component to remove or modify."
                    ),
                },
                "connection": {
                    "type": "object",
                    "description": (
                        "Connection object for add_connection.  "
                        "Must include 'from' and 'to' (component IDs).  "
                        "Optional: type, properties, notes."
                    ),
                },
                "connection_index": {
                    "type": "integer",
                    "description": (
                        "Zero-based index of the connection to remove "
                        "(use action 'list' first to see indices)."
                    ),
                },
                "new_name": {
                    "type": "string",
                    "description": "New name for the blueprint (set_name action).",
                },
                "dimensions": {
                    "type": "object",
                    "description": (
                        "Dimensions object with length, width, height, unit."
                    ),
                },
                "note": {
                    "type": "string",
                    "description": "Note text to add (add_note action).",
                },
                "tag": {
                    "type": "string",
                    "description": "Tag to add (add_tag action).",
                },
            },
            "required": ["blueprint_path", "action"],
        }

    # ── execute ──────────────────────────────────────────────────

    def execute(self, **kwargs: Any) -> ToolResult:
        blueprint_ref: str = kwargs.get("blueprint_path", "")
        action: str = kwargs.get("action", "list")

        if not blueprint_ref:
            return ToolResult.fail(
                "blueprint_path is required.",
                error_type="ValidationError",
            )

        resolved = _resolve_blueprint_path(blueprint_ref)
        if resolved is None:
            return ToolResult.fail(
                f"Blueprint not found: {blueprint_ref}",
                error_type="NotFound",
            )

        # Security check
        security = get_security_manager()
        try:
            validated_path = security.validate_file_access(resolved)
        except SecurityError as exc:
            return ToolResult.fail(str(exc), error_type="AccessDenied")

        # Load the raw JSON
        try:
            raw = json.loads(validated_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            return ToolResult.fail(
                f"Failed to read blueprint: {exc}",
                error_type="IOError",
            )

        # Dispatch
        handlers = {
            "add_component": self._add_component,
            "remove_component": self._remove_component,
            "modify_component": self._modify_component,
            "add_connection": self._add_connection,
            "remove_connection": self._remove_connection,
            "set_dimensions": self._set_dimensions,
            "set_name": self._set_name,
            "add_note": self._add_note,
            "add_tag": self._add_tag,
            "list": self._list,
        }

        handler = handlers.get(action)
        if handler is None:
            return ToolResult.fail(
                f"Unknown action: {action}",
                error_type="ValidationError",
            )

        result_msg = handler(raw, kwargs)
        if result_msg.startswith("Error:"):
            return ToolResult.fail(result_msg, error_type="EditError")

        # For read-only actions, skip writing
        if action == "list":
            return ToolResult.ok_result(
                result_msg,
                blueprint_path=str(validated_path),
                open_engine=True,
            )

        # Update modification time and hash
        raw["modified"] = datetime.now().isoformat()
        raw["hash"] = _compute_hash(raw)

        # Save
        try:
            validated_path.write_text(
                json.dumps(raw, indent=2, default=str), encoding="utf-8"
            )
        except OSError as exc:
            return ToolResult.fail(
                f"Failed to save blueprint: {exc}",
                error_type="IOError",
            )

        return ToolResult.ok_result(
            result_msg,
            blueprint_path=str(validated_path),
            blueprint_name=raw.get("name", ""),
            open_engine=True,
        )

    # ── Action handlers ──────────────────────────────────────────

    def _add_component(self, data: dict, kwargs: dict) -> str:
        comp = kwargs.get("component")
        if not comp or not isinstance(comp, dict):
            return "Error: 'component' object is required with at least 'id' and 'name'."

        if "id" not in comp:
            comp["id"] = f"comp_{uuid.uuid4().hex[:8]}"
        if "name" not in comp:
            return "Error: component must have a 'name'."

        # Defaults
        comp.setdefault("type", "generic")
        comp.setdefault("position", {"x": 0, "y": 0, "z": 0})
        comp.setdefault("rotation", {"x": 0, "y": 0, "z": 0})
        comp.setdefault("quantity", 1)

        data.setdefault("components", []).append(comp)
        return f"Added component '{comp['name']}' (id={comp['id']})."

    def _remove_component(self, data: dict, kwargs: dict) -> str:
        comp_id = kwargs.get("component_id", "")
        if not comp_id:
            return "Error: 'component_id' is required."

        components: list = data.get("components", [])
        before = len(components)
        data["components"] = [c for c in components if c.get("id") != comp_id]
        removed = before - len(data["components"])

        if removed == 0:
            return f"Error: Component '{comp_id}' not found."

        # Also remove dangling connections
        connections: list = data.get("connections", [])
        data["connections"] = [
            c
            for c in connections
            if c.get("from") != comp_id and c.get("to") != comp_id
        ]
        conn_removed = len(connections) - len(data["connections"])
        extra = (
            f" Removed {conn_removed} related connection(s)."
            if conn_removed
            else ""
        )
        return f"Removed component '{comp_id}'.{extra}"

    def _modify_component(self, data: dict, kwargs: dict) -> str:
        comp_id = kwargs.get("component_id", "")
        updates = kwargs.get("component")
        if not comp_id:
            return "Error: 'component_id' is required."
        if not updates or not isinstance(updates, dict):
            return "Error: 'component' object with updated fields is required."

        for comp in data.get("components", []):
            if comp.get("id") == comp_id:
                for key, value in updates.items():
                    if key != "id":  # Don't let caller change the ID
                        comp[key] = value
                return f"Modified component '{comp_id}'."
        return f"Error: Component '{comp_id}' not found."

    def _add_connection(self, data: dict, kwargs: dict) -> str:
        conn = kwargs.get("connection")
        if not conn or not isinstance(conn, dict):
            return "Error: 'connection' object with 'from' and 'to' is required."

        from_id = conn.get("from", "")
        to_id = conn.get("to", "")
        if not from_id or not to_id:
            return "Error: connection must have 'from' and 'to' component IDs."

        # Validate referenced components exist
        comp_ids = {c.get("id") for c in data.get("components", [])}
        if from_id not in comp_ids:
            return f"Error: Source component '{from_id}' not found."
        if to_id not in comp_ids:
            return f"Error: Target component '{to_id}' not found."

        conn.setdefault("type", "custom")
        data.setdefault("connections", []).append(conn)
        return f"Added connection {from_id} -> {to_id} (type={conn['type']})."

    def _remove_connection(self, data: dict, kwargs: dict) -> str:
        idx = kwargs.get("connection_index")
        if idx is None:
            # Try to remove by from/to
            conn = kwargs.get("connection")
            if conn and isinstance(conn, dict):
                from_id = conn.get("from", "")
                to_id = conn.get("to", "")
                connections: list = data.get("connections", [])
                before = len(connections)
                data["connections"] = [
                    c
                    for c in connections
                    if not (c.get("from") == from_id and c.get("to") == to_id)
                ]
                removed = before - len(data["connections"])
                if removed:
                    return f"Removed {removed} connection(s) {from_id} -> {to_id}."
                return f"Error: Connection {from_id} -> {to_id} not found."
            return "Error: 'connection_index' or 'connection' with from/to is required."

        connections = data.get("connections", [])
        if not isinstance(idx, int) or idx < 0 or idx >= len(connections):
            return f"Error: Invalid connection index {idx} (0-{len(connections)-1})."
        removed = connections.pop(idx)
        return (
            f"Removed connection [{idx}]: "
            f"{removed.get('from')} -> {removed.get('to')}."
        )

    def _set_dimensions(self, data: dict, kwargs: dict) -> str:
        dims = kwargs.get("dimensions")
        if not dims or not isinstance(dims, dict):
            return "Error: 'dimensions' object is required."
        data["dimensions"] = {**data.get("dimensions", {}), **dims}
        return f"Updated dimensions: {data['dimensions']}."

    def _set_name(self, data: dict, kwargs: dict) -> str:
        new_name = kwargs.get("new_name", "").strip()
        if not new_name:
            return "Error: 'new_name' is required."
        old_name = data.get("name", "")
        data["name"] = new_name
        return f"Renamed blueprint from '{old_name}' to '{new_name}'."

    def _add_note(self, data: dict, kwargs: dict) -> str:
        note = kwargs.get("note", "").strip()
        if not note:
            return "Error: 'note' text is required."
        data.setdefault("notes", []).append(note)
        return f"Added note: {note}"

    def _add_tag(self, data: dict, kwargs: dict) -> str:
        tag = kwargs.get("tag", "").strip()
        if not tag:
            return "Error: 'tag' is required."
        tags = data.setdefault("tags", [])
        if tag in tags:
            return f"Tag '{tag}' already exists."
        tags.append(tag)
        return f"Added tag: {tag}"

    def _list(self, data: dict, _kwargs: dict) -> str:
        lines = [f"Blueprint: {data.get('name', '?')} ({data.get('type', '?')})"]

        dims = data.get("dimensions", {})
        if dims:
            lines.append(
                f"Dimensions: {dims.get('length', 0)}x{dims.get('width', 0)}"
                f"x{dims.get('height', 0)} {dims.get('unit', 'mm')}"
            )

        components = data.get("components", [])
        lines.append(f"\nComponents ({len(components)}):")
        for c in components:
            pos = c.get("position", {})
            pos_str = ""
            if isinstance(pos, dict):
                pos_str = f" @ ({pos.get('x', 0)}, {pos.get('y', 0)}, {pos.get('z', 0)})"
            elif isinstance(pos, (list, tuple)) and len(pos) >= 3:
                pos_str = f" @ ({pos[0]}, {pos[1]}, {pos[2]})"
            lines.append(
                f"  [{c.get('id', '?')}] {c.get('name', '?')} "
                f"(type={c.get('type', 'generic')}){pos_str}"
            )

        connections = data.get("connections", [])
        lines.append(f"\nConnections ({len(connections)}):")
        for i, cn in enumerate(connections):
            lines.append(
                f"  [{i}] {cn.get('from', '?')} -> {cn.get('to', '?')} "
                f"(type={cn.get('type', 'custom')})"
            )

        notes = data.get("notes", [])
        if notes:
            lines.append(f"\nNotes ({len(notes)}):")
            for n in notes:
                lines.append(f"  - {n}")

        tags = data.get("tags", [])
        if tags:
            lines.append(f"\nTags: {', '.join(tags)}")

        return "\n".join(lines)
