"""Tool to load and apply blueprints."""

from __future__ import annotations

# Standard library imports
import json
from pathlib import Path
from typing import Any

# Local application imports
from core.base_tool import BaseTool
from core.security import get_security_manager


class LoadBlueprintTool(BaseTool):
    """Tool for loading blueprints."""

    @property
    def name(self) -> str:
        return "load_blueprint"

    @property
    def description(self) -> str:
        return "Loads and applies a specified blueprint."

    def execute(self, blueprint_name: str = "") -> str:
        if not blueprint_name:
            return "Please specify a blueprint name to load."

        # Security: prevent path traversal by constructing a path with Path APIs,
        # resolving it to a canonical absolute path, and validating it against
        # SecurityManager allow/block rules.
        base_dir = Path("data/blueprints")
        candidate = (base_dir / f"{blueprint_name}.json")

        security = get_security_manager()
        try:
            resolved = candidate.resolve()
            resolved = security.validate_file_access(resolved)
        except Exception as e:
            return f"Blueprint '{blueprint_name}' not found."

        if not resolved.exists():
            return f"Blueprint '{blueprint_name}' not found."

        try:
            with resolved.open("r", encoding="utf-8") as f:
                data: dict[str, Any] = json.load(f)

            # Apply theme if present
            if "theme" in data:
                from config.config import current_theme

                current_theme.update(data["theme"])

            # Profile could be handled similarly if there's a current_profile
            # For now, just load it

            return f"Blueprint '{blueprint_name}' loaded and applied successfully."
        except Exception as e:
            return f"Failed to load blueprint '{blueprint_name}': {str(e)}"

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
