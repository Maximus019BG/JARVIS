"""Tool to load and apply .jarvis blueprints.

Loads blueprints from .jarvis files (or legacy .json) and opens the
blueprint engine for interactive editing via gesture control.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.security import get_security_manager


class LoadBlueprintTool(BaseTool):
    """Tool for loading blueprints and opening them in the engine.

    Supports both .jarvis (full format) and legacy .json files.
    When a blueprint is loaded, it signals the TUI to open the
    split-pane blueprint engine view.
    """

    @property
    def name(self) -> str:
        return "load_blueprint"

    @property
    def description(self) -> str:
        return (
            "Loads a .jarvis blueprint and opens it in the blueprint engine "
            "for interactive editing with the grid view and gesture controls."
        )

    def execute(self, blueprint_name: str = "") -> ToolResult:
        if not blueprint_name:
            return ToolResult.fail(
                "Please specify a blueprint name to load.",
                error_type="ValidationError",
            )

        base_dir = Path("data/blueprints")
        security = get_security_manager()

        # Try .jarvis first, then fall back to .json
        candidate_jarvis = base_dir / f"{blueprint_name}.jarvis"
        candidate_json = base_dir / f"{blueprint_name}.json"

        resolved = None
        file_format = None

        for candidate, fmt in [
            (candidate_jarvis, "jarvis"),
            (candidate_json, "json"),
        ]:
            try:
                r = candidate.resolve()
                r = security.validate_file_access(r)
                if r.exists():
                    resolved = r
                    file_format = fmt
                    break
            except Exception:
                continue

        if resolved is None:
            return ToolResult.fail(
                f"Blueprint '{blueprint_name}' not found. "
                f"Looked for {blueprint_name}.jarvis and {blueprint_name}.json "
                f"in data/blueprints/.",
                error_type="NotFound",
            )

        try:
            with resolved.open("r", encoding="utf-8") as f:
                data: dict[str, Any] = json.load(f)

            # Determine if this is a .jarvis-format blueprint
            is_jarvis_format = "jarvis_version" in data

            if is_jarvis_format:
                bp_name = data.get("name", blueprint_name)
                bp_type = data.get("type", "part")
                bp_id = data.get("id", "")
                component_count = len(data.get("components", []))

                return ToolResult.ok_result(
                    f"Blueprint '{bp_name}' loaded ({bp_type}, "
                    f"{component_count} components). "
                    f"Opening blueprint engine for interactive editing.",
                    blueprint_path=str(resolved),
                    blueprint_name=bp_name,
                    blueprint_id=bp_id,
                    blueprint_type=bp_type,
                    component_count=component_count,
                    open_engine=True,
                )
            else:
                # Legacy .json - apply theme if present
                if "theme" in data:
                    from config.config import current_theme
                    current_theme.update(data["theme"])

                return ToolResult.ok_result(
                    f"Legacy blueprint '{blueprint_name}' loaded and applied. "
                    f"Opening blueprint engine for interactive editing.",
                    blueprint_path=str(resolved),
                    blueprint_name=blueprint_name,
                    open_engine=True,
                )

        except json.JSONDecodeError as e:
            return ToolResult.fail(
                f"Blueprint '{blueprint_name}' has invalid JSON: {e}",
                error_type="ParseError",
            )
        except Exception as e:
            return ToolResult.fail(
                f"Failed to load blueprint '{blueprint_name}': {str(e)}",
                error_type="Exception",
            )

    def schema_parameters(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {
                "blueprint_name": {
                    "type": "string",
                    "description": (
                        "The name of the blueprint to load "
                        "(without .jarvis/.json extension)."
                    ),
                },
            },
            "required": ["blueprint_name"],
            "additionalProperties": False,
        }
