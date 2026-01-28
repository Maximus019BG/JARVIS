"""Tool to create new blueprints."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult


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
    ) -> ToolResult:
        name = blueprint_name.strip()
        if not name:
            return ToolResult.fail(
                "Please specify a blueprint name to create.",
                error_type="ValidationError",
            )

        # Use defaults if not provided.
        if theme is None:
            # Keep backwards compatibility with existing config module.
            from config.config import ThemeManager

            theme = ThemeManager.DEFAULT_THEME
        if profile is None:
            profile = {}

        data: dict[str, Any] = {"theme": theme, "profile": profile}

        path = Path("data") / "blueprints" / f"{name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)

        try:
            path.write_text(json.dumps(data, indent=4), encoding="utf-8")
            return ToolResult.ok_result(f"Blueprint '{name}' created successfully.")
        except PermissionError as exc:
            return ToolResult.fail(
                f"Failed to create blueprint '{name}': Permission denied - {exc}",
                error_type="AccessDenied",
            )
        except OSError as exc:
            return ToolResult.fail(
                f"Failed to create blueprint '{name}': File system error - {exc}",
                error_type="OSError",
            )
        except (TypeError, ValueError) as exc:
            return ToolResult.fail(
                f"Failed to create blueprint '{name}': Invalid data format - {exc}",
                error_type="ValidationError",
            )
        except Exception as exc:
            return ToolResult.fail(
                f"Failed to create blueprint '{name}': Unexpected error - {exc}",
                error_type="Exception",
            )

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
