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

from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolResult
from core.security import SecurityError, get_security_manager
from core.sync.async_bridge import run_coro_sync
from core.sync.sync_factory import build_sync_stack

logger = get_logger(__name__)


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
            "set_name, add_note, add_tag, "
            "add_line, add_circle, add_rect, add_arc, add_text, "
            "clear_drawings, reset, list.  "
            "Use 'reset' to restore the blueprint to a blank state "
            "(keeps metadata, clears all components, connections and drawings)."
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
                        "add_line",
                        "add_circle",
                        "add_rect",
                        "add_arc",
                        "add_text",
                        "clear_drawings",
                        "reset",
                        "list",
                    ],
                    "description": "Edit action to perform on the blueprint.",
                },
                "component": {
                    "type": ["object", "string"],
                    "description": (
                        "Component object for add_component / modify_component "
                        "(object with id, name, type, position, etc.), "
                        "OR a component ID string for remove_component."
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
                "drawing": {
                    "type": "object",
                    "description": (
                        "Drawing primitive for add_line/add_circle/add_rect/"
                        "add_arc/add_text. All coords are percentages 0-100. "
                        "Line: {x1,y1,x2,y2,color,style,label}. "
                        "Circle: {cx,cy,r,color,fill,label}. "
                        "Rect: {x,y,w,h,color,fill,label}. "
                        "Arc: {cx,cy,r,start_angle,end_angle,color,label}. "
                        "Text: {x,y,text,color,bold}."
                    ),
                },
            },
            "required": ["blueprint_path", "action"],
        }

    # ── execute ──────────────────────────────────────────────────

    def execute(self, **kwargs: Any) -> ToolResult:
        logger.info("edit_blueprint called: kwargs=%s", kwargs)
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
            "add_line": self._add_line,
            "add_circle": self._add_circle,
            "add_rect": self._add_rect,
            "add_arc": self._add_arc,
            "add_text": self._add_text,
            "clear_drawings": self._clear_drawings,
            "reset": self._reset,
            "list": self._list,
        }

        handler = handlers.get(action)
        if handler is None:
            return ToolResult.fail(
                f"Unknown action: {action}",
                error_type="ValidationError",
            )

        result_msg = handler(raw, kwargs)
        logger.info("edit_blueprint action=%s result: %s", action, result_msg)
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

        sync_status = "local_only"
        sync_error: str | None = None
        try:
            stack = build_sync_stack()
            sync_response = run_coro_sync(
                stack.sync_manager.send_blueprint(str(validated_path)),
                timeout=90,
            )
            sync_status = str(sync_response.get("syncStatus", "synced"))
        except Exception as exc:
            sync_status = "queued"
            sync_error = str(exc)
            logger.warning(
                "Blueprint edit saved locally but immediate cloud sync failed; queued for retry: %s",
                exc,
            )

        content = result_msg
        if sync_status == "queued":
            content += " Cloud sync queued for retry."

        return ToolResult.ok_result(
            content,
            blueprint_path=str(validated_path),
            blueprint_name=raw.get("name", ""),
            open_engine=True,
            sync_status=sync_status,
            sync_error=sync_error,
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

    @staticmethod
    def _resolve_component_id(
        components: list[dict], ref: str,
    ) -> str | None:
        """Resolve a component reference to its actual ID.

        Tries (in order):
        1. Exact ID match
        2. Case-insensitive ID match
        3. Exact name match
        4. Case-insensitive name match
        5. Normalized match (strip spaces, underscores, hyphens)
        """
        if not ref:
            return None
        ref_lower = ref.lower().strip()
        ref_norm = ref_lower.replace(" ", "").replace("_", "").replace("-", "")

        # 1 & 2: ID match
        for c in components:
            cid = c.get("id", "")
            if cid == ref:
                return cid
        for c in components:
            cid = c.get("id", "")
            if cid.lower() == ref_lower:
                return cid

        # 3 & 4: Name match
        for c in components:
            if c.get("name", "") == ref:
                return c.get("id", "")
        for c in components:
            if c.get("name", "").lower() == ref_lower:
                return c.get("id", "")

        # 5: Normalized match (handles "eye_2" vs "eye2", "Eye 1" vs "eye1")
        for c in components:
            cid_norm = c.get("id", "").lower().replace(" ", "").replace("_", "").replace("-", "")
            cname_norm = c.get("name", "").lower().replace(" ", "").replace("_", "").replace("-", "")
            if cid_norm == ref_norm or cname_norm == ref_norm:
                return c.get("id", "")

        return None

    def _remove_component(self, data: dict, kwargs: dict) -> str:
        comp_ref = kwargs.get("component_id", "")
        # LLMs often send the ID via "component" as a string
        if not comp_ref:
            c = kwargs.get("component", "")
            if isinstance(c, str) and c:
                comp_ref = c
            elif isinstance(c, dict) and "id" in c:
                comp_ref = c["id"]
            elif isinstance(c, dict) and "name" in c:
                comp_ref = c["name"]
        if not comp_ref:
            return "Error: 'component_id' is required."

        components: list = data.get("components", [])
        comp_id = self._resolve_component_id(components, comp_ref)
        if not comp_id:
            available = ", ".join(
                f"'{c.get('id')}' ({c.get('name', '?')})"
                for c in components
            )
            return f"Error: Component '{comp_ref}' not found. Available: {available}"

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
        comp_ref = kwargs.get("component_id", "")
        updates = kwargs.get("component")
        if not comp_ref and isinstance(updates, dict) and "id" in updates:
            comp_ref = updates["id"]
        if not comp_ref:
            return "Error: 'component_id' is required."
        if not updates or not isinstance(updates, dict):
            return "Error: 'component' object with updated fields is required."

        components = data.get("components", [])
        comp_id = self._resolve_component_id(components, comp_ref)
        if not comp_id:
            available = ", ".join(
                f"'{c.get('id')}' ({c.get('name', '?')})"
                for c in components
            )
            return f"Error: Component '{comp_ref}' not found. Available: {available}"

        for comp in components:
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

    # ── Drawing primitive handlers ───────────────────────────────

    # Keys that belong to the tool dispatch itself, not to a drawing primitive.
    _META_KEYS = frozenset(
        {"blueprint_path", "action", "component_id", "connection",
         "connection_index", "new_name", "dimensions", "note", "tag"}
    )

    def _get_drawing(self, kwargs: dict, *, hint: str = "") -> dict | None:
        """Extract the drawing-primitive dict from *kwargs*.

        Tries (in order):
        1. ``kwargs["drawing"]``  – canonical schema key
        2. ``kwargs["component"]`` – common LLM alias
        3. Action-specific key derived from *hint*
           (e.g. hint="line" → ``kwargs["line"]``)
        4. Flat kwargs – if the caller embedded coordinate keys directly
           (x1, y1, cx, cy, …) we scoop up every key that isn't a
           meta/dispatch key and return them as the drawing dict.
        """
        # 1. canonical
        d = kwargs.get("drawing")
        if d and isinstance(d, dict):
            return d

        # 2. common alias
        d = kwargs.get("component")
        if d and isinstance(d, dict):
            return d

        # 3. action-specific key  (e.g. "line", "circle", "rect", …)
        if hint:
            d = kwargs.get(hint)
            if d and isinstance(d, dict):
                return d

        # 4. flat kwargs – collect everything that isn't a meta key
        #    Only skip the hint key when its value is a dict (action wrapper),
        #    not when it's a scalar (e.g. text="Hello" for add_text).
        skip = {"drawing", "component"}
        if hint and isinstance(kwargs.get(hint), dict):
            skip.add(hint)
        flat = {
            k: v for k, v in kwargs.items()
            if k not in self._META_KEYS and k not in skip
        }
        if flat:
            return flat

        return None

    def _add_line(self, data: dict, kwargs: dict) -> str:
        d = self._get_drawing(kwargs, hint="line")
        if not d or not isinstance(d, dict):
            return "Error: 'drawing' object with {x1, y1, x2, y2} is required."
        for key in ("x1", "y1", "x2", "y2"):
            if key not in d:
                return f"Error: line drawing must have '{key}' (percentage 0-100)."
        d.setdefault("color", "cyan")
        d.setdefault("style", "solid")
        d.setdefault("label", "")
        data.setdefault("lines", []).append(d)
        return f"Added line ({d['x1']},{d['y1']})->({d['x2']},{d['y2']}) color={d['color']}."

    def _add_circle(self, data: dict, kwargs: dict) -> str:
        d = self._get_drawing(kwargs, hint="circle")
        if not d or not isinstance(d, dict):
            return "Error: 'drawing' object with {cx, cy, r} is required."
        for key in ("cx", "cy", "r"):
            if key not in d:
                return f"Error: circle drawing must have '{key}' (percentage 0-100)."
        d.setdefault("color", "cyan")
        d.setdefault("fill", False)
        d.setdefault("label", "")
        data.setdefault("circles", []).append(d)
        return f"Added circle at ({d['cx']},{d['cy']}) r={d['r']} color={d['color']}."

    def _add_rect(self, data: dict, kwargs: dict) -> str:
        d = self._get_drawing(kwargs, hint="rect")
        if not d or not isinstance(d, dict):
            return "Error: 'drawing' object with {x, y, w, h} is required."
        for key in ("x", "y", "w", "h"):
            if key not in d:
                return f"Error: rect drawing must have '{key}' (percentage 0-100)."
        d.setdefault("color", "cyan")
        d.setdefault("fill", False)
        d.setdefault("label", "")
        data.setdefault("rects", []).append(d)
        return f"Added rect at ({d['x']},{d['y']}) {d['w']}x{d['h']} color={d['color']}."

    def _add_arc(self, data: dict, kwargs: dict) -> str:
        d = self._get_drawing(kwargs, hint="arc")
        if not d or not isinstance(d, dict):
            return "Error: 'drawing' object with {cx, cy, r, start_angle, end_angle} is required."
        for key in ("cx", "cy", "r"):
            if key not in d:
                return f"Error: arc drawing must have '{key}' (percentage 0-100)."
        d.setdefault("start_angle", 0)
        d.setdefault("end_angle", 180)
        d.setdefault("color", "cyan")
        d.setdefault("label", "")
        data.setdefault("arcs", []).append(d)
        return f"Added arc at ({d['cx']},{d['cy']}) r={d['r']} {d['start_angle']}°-{d['end_angle']}°."

    def _add_text(self, data: dict, kwargs: dict) -> str:
        d = self._get_drawing(kwargs, hint="text")
        if not d or not isinstance(d, dict):
            return "Error: 'drawing' object with {x, y, text} is required."
        for key in ("x", "y", "text"):
            if key not in d:
                return f"Error: text drawing must have '{key}'."
        d.setdefault("color", "white")
        d.setdefault("bold", False)
        data.setdefault("texts", []).append(d)
        return f"Added text '{d['text']}' at ({d['x']},{d['y']})."

    def _clear_drawings(self, data: dict, _kwargs: dict) -> str:
        counts = {}
        for key in ("lines", "circles", "rects", "arcs", "texts"):
            counts[key] = len(data.get(key, []))
            data[key] = []
        total = sum(counts.values())
        return f"Cleared {total} drawing primitives ({counts})."

    def _reset(self, data: dict, _kwargs: dict) -> str:
        """Reset the blueprint to a blank state.

        Keeps identity & metadata (id, type, name, description, created,
        author, version, sync, security, dimensions).  Clears everything else:
        components, connections, drawings, notes, tags, materials.
        """
        cleared: list[str] = []

        for key, label in (
            ("components", "components"),
            ("connections", "connections"),
            ("materials", "materials"),
            ("notes", "notes"),
            ("tags", "tags"),
            ("lines", "lines"),
            ("circles", "circles"),
            ("rects", "rects"),
            ("arcs", "arcs"),
            ("texts", "texts"),
        ):
            items = data.get(key, [])
            if items:
                cleared.append(f"{len(items)} {label}")
                data[key] = []

        if not cleared:
            return "Blueprint is already empty — nothing to reset."

        data["version"] = data.get("version", 0) + 1
        return f"Reset blueprint. Cleared: {', '.join(cleared)}."

    # ── List handler ─────────────────────────────────────────────

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

        # Drawing primitives summary
        draw_lines = data.get("lines", [])
        draw_circles = data.get("circles", [])
        draw_rects = data.get("rects", [])
        draw_arcs = data.get("arcs", [])
        draw_texts = data.get("texts", [])
        total_drawings = (
            len(draw_lines) + len(draw_circles) + len(draw_rects)
            + len(draw_arcs) + len(draw_texts)
        )
        if total_drawings:
            lines.append(
                f"\nDrawing Primitives ({total_drawings}):"
                f"  {len(draw_lines)} lines, {len(draw_circles)} circles, "
                f"{len(draw_rects)} rects, {len(draw_arcs)} arcs, "
                f"{len(draw_texts)} texts"
            )

        return "\n".join(lines)
