"""Tool to delete a .jarvis blueprint from disk."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.security import SecurityError, get_security_manager


def _resolve_blueprint_path(ref: str) -> Path | None:
    """Resolve a blueprint reference to an absolute file path."""
    p = Path(ref)
    if p.is_absolute() and p.exists():
        return p
    if p.exists():
        return p.resolve()

    bp_dir = Path("data") / "blueprints"
    candidate = bp_dir / p
    if candidate.exists():
        return candidate.resolve()

    if not p.suffix:
        candidate = bp_dir / f"{ref}.jarvis"
        if candidate.exists():
            return candidate.resolve()

    return None


class DeleteBlueprintTool(BaseTool):
    """Delete a .jarvis blueprint file from disk."""

    @property
    def name(self) -> str:
        return "delete_blueprint"

    @property
    def description(self) -> str:
        return (
            "Delete a .jarvis blueprint file. Accepts a blueprint name "
            "(without extension), a relative path, or an absolute path. "
            "This permanently removes the file from disk."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "blueprint_name": {
                    "type": "string",
                    "description": (
                        "Name or path of the blueprint to delete. "
                        "Can be just the name (without .jarvis), "
                        "a relative path, or an absolute path."
                    ),
                },
            },
            "required": ["blueprint_name"],
        }

    def execute(self, **kwargs: Any) -> ToolResult:
        ref: str = kwargs.get("blueprint_name", "").strip()
        if not ref:
            return ToolResult.fail(
                "blueprint_name is required.",
                error_type="ValidationError",
            )

        resolved = _resolve_blueprint_path(ref)
        if resolved is None:
            return ToolResult.fail(
                f"Blueprint not found: {ref}",
                error_type="NotFound",
            )

        # Security check
        security = get_security_manager()
        try:
            validated_path = security.validate_file_access(resolved)
        except SecurityError as exc:
            return ToolResult.fail(str(exc), error_type="AccessDenied")

        # Read name for confirmation message before deleting
        display_name = validated_path.stem
        try:
            data = json.loads(validated_path.read_text(encoding="utf-8"))
            display_name = data.get("name", validated_path.stem)
        except Exception:
            pass

        # Delete the file
        try:
            validated_path.unlink()
        except OSError as exc:
            return ToolResult.fail(
                f"Failed to delete blueprint: {exc}",
                error_type="IOError",
            )

        return ToolResult.ok_result(
            f"Deleted blueprint '{display_name}' ({validated_path.name})."
        )
