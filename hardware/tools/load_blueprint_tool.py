"""Tool to load and apply blueprints."""

import json
import os
from typing import Any, Dict

from core.base_tool import BaseTool


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

        path = f"data/blueprints/{blueprint_name}.json"
        if not os.path.exists(path):
            return f"Blueprint '{blueprint_name}' not found."

        try:
            with open(path, "r") as f:
                data: Dict[str, Any] = json.load(f)

            # Apply theme if present
            if "theme" in data:
                from config.config import current_theme

                current_theme.update(data["theme"])

            # Profile could be handled similarly if there's a current_profile
            # For now, just load it

            return f"Blueprint '{blueprint_name}' loaded and applied successfully."
        except Exception as e:
            return f"Failed to load blueprint '{blueprint_name}': {str(e)}"

    def get_schema(self) -> Dict:
        schema = super().get_schema()
        schema["function"]["parameters"]["properties"] = {
            "blueprint_name": {
                "type": "string",
                "description": "The name of the blueprint to load",
            }
        }
        schema["function"]["parameters"]["required"] = ["blueprint_name"]
        return schema
