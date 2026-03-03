"""Tool to list all available .jarvis blueprints.

Scans the data/blueprints directory and returns names, types, and
descriptions so the agent can give accurate answers about what
blueprints exist.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult


class ListBlueprintsTool(BaseTool):
    """Tool for listing all available blueprints on disk.

    Scans ``data/blueprints/`` for ``.jarvis`` (and ``.json``) files
    and returns a summary of each one so the LLM never has to guess.
    """

    @property
    def name(self) -> str:
        return "list_blueprints"

    @property
    def description(self) -> str:
        return (
            "Lists every blueprint stored in data/blueprints/. "
            "Returns name, type, component count, and description "
            "for each blueprint. Use this before trying to load a "
            "blueprint so you know the exact name."
        )

    def execute(self, **kwargs: Any) -> ToolResult:
        base_dir = Path("data/blueprints")

        if not base_dir.exists():
            return ToolResult.fail(
                "Blueprint directory data/blueprints/ does not exist.",
                error_type="NotFound",
            )

        blueprints: list[dict[str, Any]] = []

        for ext in ("*.jarvis", "*.json"):
            for fp in sorted(base_dir.glob(ext)):
                entry: dict[str, Any] = {
                    "file": fp.name,
                    "name": fp.stem,
                }
                try:
                    data = json.loads(fp.read_text(encoding="utf-8"))
                    entry["display_name"] = data.get("name", fp.stem)
                    entry["type"] = data.get("type", "unknown")
                    entry["description"] = data.get("description", "")
                    entry["components"] = len(data.get("components", []))
                    entry["lines"] = len(data.get("lines", []))
                    entry["has_drawings"] = any(
                        len(data.get(k, [])) > 0
                        for k in ("lines", "circles", "rects", "arcs", "texts")
                    )
                except Exception:
                    entry["error"] = "could not parse file"

                blueprints.append(entry)

        if not blueprints:
            return ToolResult.ok_result(
                "No blueprints found in data/blueprints/."
            )

        # Build a human-readable summary
        lines: list[str] = [f"Found {len(blueprints)} blueprint(s):\n"]
        for bp in blueprints:
            display = bp.get("display_name", bp["name"])
            bp_type = bp.get("type", "?")
            comps = bp.get("components", 0)
            desc = bp.get("description", "")
            drawings = " (has drawings)" if bp.get("has_drawings") else ""
            err = bp.get("error", "")
            if err:
                lines.append(f"• {bp['file']}  —  ⚠ {err}")
            else:
                lines.append(
                    f"• {display} ({bp['file']})  —  "
                    f"type: {bp_type}, {comps} component(s){drawings}"
                )
                if desc:
                    lines.append(f"    {desc}")

        summary = "\n".join(lines)

        return ToolResult.ok_result(
            summary,
            blueprints=blueprints,
        )

    def schema_parameters(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        }
