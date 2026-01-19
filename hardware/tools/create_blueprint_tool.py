"""Tool to create new blueprints."""

import json
import os
from typing import Any, Dict

from core.base_tool import BaseTool


class CreateBlueprintTool(BaseTool):
    """Tool for creating blueprints."""

    @property
    def name(self) -> str:
        return "create_blueprint"

    @property
    def description(self) -> str:
        return "Creates a new blueprint with the given name and optional configuration."

    def execute(self, blueprint_name: str = "", theme: Dict[str, str] = None, profile: Dict[str, str] = None) -> str:
        if not blueprint_name:
            return "Please specify a blueprint name to create."

        # Use defaults if not provided
        if theme is None:
            from config.config import DEFAULT_THEME
            theme = DEFAULT_THEME
        if profile is None:
            profile = {}

        data: Dict[str, Any] = {
            "theme": theme,
            "profile": profile
        }

        path = f"data/blueprints/{blueprint_name}.json"
        os.makedirs(os.path.dirname(path), exist_ok=True)

        try:
            with open(path, 'w') as f:
                json.dump(data, f, indent=4)
            return f"Blueprint '{blueprint_name}' created successfully."
        except Exception as e:
            return f"Failed to create blueprint '{blueprint_name}': {str(e)}"

    def get_schema(self) -> Dict:
        schema = super().get_schema()
        schema["function"]["parameters"]["properties"] = {
            "blueprint_name": {
                "type": "string",
                "description": "The name of the blueprint to create"
            },
            "theme": {
                "type": "object",
                "description": "Theme configuration as a dictionary of color values",
                "additionalProperties": {"type": "string"}
            },
            "profile": {
                "type": "object",
                "description": "Profile configuration as a dictionary",
                "additionalProperties": {"type": "string"}
            }
        }
        schema["function"]["parameters"]["required"] = ["blueprint_name"]
        return schema
