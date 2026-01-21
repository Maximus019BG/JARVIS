"""Tool to create new blueprints."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool


class CreateBlueprintTool(BaseTool):
    """Tool for creating blueprints."""

    @property
    def name(self) -> str:
        return "create_blueprint"

    @property
    def description(self) -> str:
        return "Creates a new blueprint with the given name and optional configuration."

    def execute(
        self,
        blueprint_name: str = "",
        theme: dict[str, str] | None = None,
        profile: dict[str, str] | None = None,
    ) -> str:
        name = blueprint_name.strip()
        if not name:
            return "Please specify a blueprint name to create."

        # Use defaults if not provided.
        if theme is None:
            # Keep backwards compatibility with existing config module.
            from config.config import DEFAULT_THEME

            theme = DEFAULT_THEME
        if profile is None:
            profile = {}

        data: dict[str, Any] = {"theme": theme, "profile": profile}

        path = Path("data") / "blueprints" / f"{name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)

        try:
            path.write_text(json.dumps(data, indent=4), encoding="utf-8")
            return f"Blueprint '{name}' created successfully."
        except Exception as exc:
            return f"Failed to create blueprint '{name}': {exc}"

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "blueprint_name": {
                    "type": "string",
                    "description": "The name of the blueprint to create",
                },
                "theme": {
                    "type": "object",
                    "description": "Theme configuration as a dictionary of color values",
                    "additionalProperties": {"type": "string"},
                },
                "profile": {
                    "type": "object",
                    "description": "Profile configuration as a dictionary",
                    "additionalProperties": {"type": "string"},
                },
            },
            "required": ["blueprint_name"],
        }
