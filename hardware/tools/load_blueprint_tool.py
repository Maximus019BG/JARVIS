"""Tool to load and apply blueprints."""

from __future__ import annotations

# Standard library imports
import json
from pathlib import Path
from typing import Any

# Local application imports
from core.base_tool import BaseTool, ToolResult
from core.security import get_security_manager


class LoadBlueprintTool(BaseTool):
    """Tool for loading blueprints."""

    @property
    def name(self) -> str:
        return "load_blueprint"

    @property
    def description(self) -> str:
        return "Loads and applies a specified blueprint."

    def execute(self, blueprint_name: str = "") -> ToolResult:
        if not blueprint_name:
            return ToolResult.fail(
                "Please specify a blueprint name to load.",
                error_type="ValidationError",
            )

        # Security: prevent path traversal by constructing a path with Path APIs,
        # resolving it to a canonical absolute path, and validating it against
        # SecurityManager allow/block rules.
        base_dir = Path("data/blueprints")
        candidate = base_dir / f"{blueprint_name}.json"

        security = get_security_manager()
        try:
            resolved = candidate.resolve()
            resolved = security.validate_file_access(resolved)
        except Exception:
            return ToolResult.fail(
                f"Blueprint '{blueprint_name}' not found.",
                error_type="NotFound",
            )

        if not resolved.exists():
            return ToolResult.fail(
                f"Blueprint '{blueprint_name}' not found.",
                error_type="NotFound",
            )

        try:
            with resolved.open("r", encoding="utf-8") as f:
                data: dict[str, Any] = json.load(f)

            # Apply theme if present
            if "theme" in data:
                from config.config import current_theme

                current_theme.update(data["theme"])

            # Profile could be handled similarly if there's a current_profile
            # For now, just load it

            return ToolResult.ok_result(
                f"Blueprint '{blueprint_name}' loaded and applied successfully."
            )
        except Exception as e:
            return ToolResult.fail(
                f"Failed to load blueprint '{blueprint_name}': {str(e)}",
                error_type="Exception",
            )

    def get_schema(self) -> dict:
        schema = super().get_schema()
        schema["function"]["parameters"]["properties"] = {
            "blueprint_name": {
                "type": "string",
                "description": "The name of the blueprint to load",
            }
        }
        schema["function"]["parameters"]["required"] = ["blueprint_name"]
        return schema
