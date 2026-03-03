"""Blueprint Corruption Fixer.

Detects and repairs .jarvis blueprints that don't follow the standard format.

Common problems fixed:
- Visual shapes (line, circle, rect) placed in ``components`` instead of
  drawing-primitive arrays (lines, circles, rects, arcs, texts).
- Missing drawing-primitive arrays.
- Invisible colours (e.g. "black" on a dark background).
- Components with type "line" that are really visual shapes.
- Dimensions set to zero when components exist.
- Missing ``id`` / ``modified`` fields.

Usage:
    from core.blueprint.fixer import fix_blueprint_dict, fix_blueprint_file
    issues = fix_blueprint_file("data/blueprints/duck.jarvis")
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

from app_logging.logger import get_logger

logger = get_logger(__name__)

# Component types that are really drawing shapes and should be
# migrated to the drawing arrays.
_VISUAL_SHAPE_TYPES = {"line", "circle", "rect", "rectangle", "arc", "text", "label"}

# Colours that are invisible or near-invisible on a dark terminal bg.
_BAD_COLOURS: dict[str, str] = {
    "black": "cyan",
    "#000000": "cyan",
    "#000": "cyan",
    "#111": "grey70",
    "#111111": "grey70",
    "": "cyan",
}


# ── Public API ───────────────────────────────────────────────────────

def fix_blueprint_dict(data: dict[str, Any]) -> list[str]:
    """Fix a blueprint dict **in-place** and return a list of changes made.

    Parameters
    ----------
    data:
        The raw JSON dict of the .jarvis file.

    Returns
    -------
    List of human-readable fix descriptions (empty if nothing changed).
    """
    fixes: list[str] = []
    fixes.extend(_ensure_drawing_arrays(data))
    fixes.extend(_migrate_shape_components(data))
    fixes.extend(_fix_invisible_colours(data))
    fixes.extend(_fix_missing_fields(data))
    fixes.extend(_fix_dimensions_unit(data))

    if fixes:
        data["modified"] = datetime.now().isoformat()
        data["hash"] = _compute_hash(data)
        logger.info("Blueprint fixed (%d issue(s)): %s", len(fixes), "; ".join(fixes))

    return fixes


def fix_blueprint_file(path: str | Path, *, dry_run: bool = False) -> list[str]:
    """Load a .jarvis file, fix it, and save it back.

    Parameters
    ----------
    path:
        Path to the .jarvis file.
    dry_run:
        If True, report what would be fixed without writing.

    Returns
    -------
    List of fix descriptions.
    """
    path = Path(path)
    if not path.exists():
        return [f"File not found: {path}"]

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return [f"Cannot read {path}: {exc}"]

    fixes = fix_blueprint_dict(data)

    if fixes and not dry_run:
        path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
        logger.info("Saved fixed blueprint to %s", path)

    return fixes


# ── Internal fixers ──────────────────────────────────────────────────

def _ensure_drawing_arrays(data: dict[str, Any]) -> list[str]:
    """Ensure all five drawing arrays exist."""
    fixes: list[str] = []
    for key in ("lines", "circles", "rects", "arcs", "texts"):
        if key not in data:
            data[key] = []
            fixes.append(f"Added missing '{key}' array")
    return fixes


def _migrate_shape_components(data: dict[str, Any]) -> list[str]:
    """Move components that are really visual shapes to drawing arrays."""
    fixes: list[str] = []
    remaining_components: list[dict[str, Any]] = []

    for comp in data.get("components", []):
        ctype = str(comp.get("type", "")).lower().strip()

        if ctype not in _VISUAL_SHAPE_TYPES:
            remaining_components.append(comp)
            continue

        # ── Convert to drawing primitive ────────────────────────
        if ctype == "line":
            drawing = _component_to_line(comp)
            data.setdefault("lines", []).append(drawing)
            fixes.append(f"Migrated component '{comp.get('name', comp.get('id', '?'))}' from components to lines[]")

        elif ctype in ("circle",):
            drawing = _component_to_circle(comp)
            data.setdefault("circles", []).append(drawing)
            fixes.append(f"Migrated component '{comp.get('name', comp.get('id', '?'))}' from components to circles[]")

        elif ctype in ("rect", "rectangle"):
            drawing = _component_to_rect(comp)
            data.setdefault("rects", []).append(drawing)
            fixes.append(f"Migrated component '{comp.get('name', comp.get('id', '?'))}' from components to rects[]")

        elif ctype == "arc":
            drawing = _component_to_arc(comp)
            data.setdefault("arcs", []).append(drawing)
            fixes.append(f"Migrated component '{comp.get('name', comp.get('id', '?'))}' from components to arcs[]")

        elif ctype in ("text", "label"):
            drawing = _component_to_text(comp)
            data.setdefault("texts", []).append(drawing)
            fixes.append(f"Migrated component '{comp.get('name', comp.get('id', '?'))}' from components to texts[]")

        else:
            # Unknown shape type — keep as component
            remaining_components.append(comp)

    # Also remove connections that reference migrated components
    migrated_ids = {
        c.get("id") for c in data.get("components", [])
        if str(c.get("type", "")).lower().strip() in _VISUAL_SHAPE_TYPES
    }
    if migrated_ids:
        old_conns = data.get("connections", [])
        data["connections"] = [
            c for c in old_conns
            if c.get("from") not in migrated_ids and c.get("to") not in migrated_ids
        ]
        removed = len(old_conns) - len(data["connections"])
        if removed:
            fixes.append(f"Removed {removed} connection(s) referencing migrated shapes")

    data["components"] = remaining_components
    return fixes


def _fix_invisible_colours(data: dict[str, Any]) -> list[str]:
    """Replace invisible colours with visible alternatives."""
    fixes: list[str] = []

    for key in ("lines", "circles", "rects", "arcs", "texts"):
        for item in data.get(key, []):
            old_color = str(item.get("color", "")).lower().strip()
            if old_color in _BAD_COLOURS:
                new_color = _BAD_COLOURS[old_color]
                item["color"] = new_color
                label = item.get("label", item.get("text", item.get("id", "?")))
                fixes.append(f"Fixed invisible colour '{old_color}' -> '{new_color}' on {key} item '{label}'")

    return fixes


def _fix_missing_fields(data: dict[str, Any]) -> list[str]:
    """Add required fields that are missing."""
    fixes: list[str] = []

    if "jarvis_version" not in data:
        data["jarvis_version"] = "1.0"
        fixes.append("Added missing jarvis_version")

    if "name" not in data or not data["name"]:
        data["name"] = "Untitled"
        fixes.append("Added missing name")

    if "type" not in data:
        data["type"] = "part"
        fixes.append("Added missing type")

    if "id" not in data or not data["id"]:
        import uuid
        slug = data.get("name", "untitled").lower().replace(" ", "_")
        data["id"] = f"bp_{slug}_{uuid.uuid4().hex[:6]}"
        fixes.append("Generated missing blueprint ID")

    if "created" not in data:
        data["created"] = datetime.now().isoformat() + "Z"
        fixes.append("Added missing created timestamp")

    if "modified" not in data:
        data["modified"] = datetime.now().isoformat()
        fixes.append("Added missing modified timestamp")

    return fixes


def _fix_dimensions_unit(data: dict[str, Any]) -> list[str]:
    """Ensure dimensions has valid unit and reasonable defaults."""
    fixes: list[str] = []
    dims = data.get("dimensions")
    if dims and isinstance(dims, dict):
        unit = dims.get("unit", "mm")
        valid_units = {"mm", "cm", "m", "in", "ft", "px"}
        if unit.lower() not in valid_units:
            dims["unit"] = "mm"
            fixes.append(f"Fixed invalid dimension unit '{unit}' -> 'mm'")
    elif "dimensions" not in data:
        data["dimensions"] = {"length": 0, "width": 0, "height": 0, "unit": "mm"}
        fixes.append("Added missing dimensions")
    return fixes


# ── Shape conversion helpers ────────────────────────────────────────

def _get_pos(comp: dict[str, Any]) -> tuple[float, float]:
    """Extract x, y position from a component.  Returns percentages 0-100."""
    pos = comp.get("position", {})
    if isinstance(pos, dict):
        x = float(pos.get("x", 0))
        y = float(pos.get("y", 0))
    elif isinstance(pos, (list, tuple)) and len(pos) >= 2:
        x, y = float(pos[0]), float(pos[1])
    else:
        x, y = 0.0, 0.0
    # Clamp to 0-100 (they might already be percentages, or small world coords)
    x = max(0.0, min(100.0, x))
    y = max(0.0, min(100.0, y))
    return x, y


def _get_dim(comp: dict[str, Any]) -> tuple[float, float]:
    """Get length/width (or w/h) from a component's dimensions."""
    dims = comp.get("dimensions", {})
    if isinstance(dims, dict):
        length = float(dims.get("length", dims.get("w", 10)))
        width = float(dims.get("width", dims.get("h", 10)))
    else:
        length, width = 10.0, 10.0
    return length, width


def _component_to_line(comp: dict[str, Any]) -> dict[str, Any]:
    """Convert a line-type component to a DrawingLine dict."""
    x, y = _get_pos(comp)
    length, width = _get_dim(comp)
    rotation = comp.get("rotation", 0)
    if isinstance(rotation, dict):
        rotation = float(rotation.get("z", rotation.get("y", rotation.get("x", 0))))
    elif isinstance(rotation, (list, tuple)):
        rotation = float(rotation[-1]) if rotation else 0.0
    else:
        rotation = float(rotation)

    rad = math.radians(rotation)
    # Length in percentage units
    half = length / 2.0
    x1 = max(0, min(100, x - half * math.cos(rad)))
    y1 = max(0, min(100, y - half * math.sin(rad)))
    x2 = max(0, min(100, x + half * math.cos(rad)))
    y2 = max(0, min(100, y + half * math.sin(rad)))

    return {
        "x1": round(x1, 2),
        "y1": round(y1, 2),
        "x2": round(x2, 2),
        "y2": round(y2, 2),
        "color": comp.get("color", "cyan"),
        "style": comp.get("style", "solid"),
        "label": comp.get("name", ""),
    }


def _component_to_circle(comp: dict[str, Any]) -> dict[str, Any]:
    """Convert a circle-type component to a DrawingCircle dict."""
    x, y = _get_pos(comp)
    length, _ = _get_dim(comp)
    r = length / 2.0
    return {
        "cx": round(x, 2),
        "cy": round(y, 2),
        "r": round(max(1, min(50, r)), 2),
        "color": comp.get("color", "cyan"),
        "fill": bool(comp.get("fill", False)),
        "label": comp.get("name", ""),
    }


def _component_to_rect(comp: dict[str, Any]) -> dict[str, Any]:
    """Convert a rect-type component to a DrawingRect dict."""
    x, y = _get_pos(comp)
    w, h = _get_dim(comp)
    return {
        "x": round(max(0, x), 2),
        "y": round(max(0, y), 2),
        "w": round(max(1, min(100, w)), 2),
        "h": round(max(1, min(100, h)), 2),
        "color": comp.get("color", "cyan"),
        "fill": bool(comp.get("fill", False)),
        "label": comp.get("name", ""),
    }


def _component_to_arc(comp: dict[str, Any]) -> dict[str, Any]:
    """Convert an arc-type component to a DrawingArc dict."""
    x, y = _get_pos(comp)
    length, _ = _get_dim(comp)
    r = length / 2.0
    return {
        "cx": round(x, 2),
        "cy": round(y, 2),
        "r": round(max(1, min(50, r)), 2),
        "start_angle": float(comp.get("start_angle", 0)),
        "end_angle": float(comp.get("end_angle", 180)),
        "color": comp.get("color", "cyan"),
        "label": comp.get("name", ""),
    }


def _component_to_text(comp: dict[str, Any]) -> dict[str, Any]:
    """Convert a text-type component to a DrawingText dict."""
    x, y = _get_pos(comp)
    return {
        "x": round(x, 2),
        "y": round(y, 2),
        "text": comp.get("name", comp.get("text", "Label")),
        "color": comp.get("color", "white"),
        "bold": bool(comp.get("bold", False)),
    }


def _compute_hash(data: dict[str, Any]) -> str:
    """Compute a SHA-256 content hash."""
    content_str = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(content_str.encode()).hexdigest()
