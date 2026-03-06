"""List files in the data directory (code scripts and/or blueprints).

Gives the LLM an overview of what the user has already created so it
can reference, load, or build on existing work.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult

_DATA_ROOT = Path("data")

# Subdirectory → glob patterns
_CATEGORY_GLOBS: dict[str, list[str]] = {
    "code": ["*.py"],
    "blueprints": ["*.jarvis", "*.json"],
}


class ListDataTool(BaseTool):
    """List files stored in the data directory."""

    @property
    def name(self) -> str:
        return "list_data"

    @property
    def description(self) -> str:
        return (
            "List files in the data directory. "
            "Set category to 'code' for scripts, 'blueprints' for blueprints, "
            "or 'all' to list everything. Returns filenames, sizes, and brief "
            "summaries. Use this when the user asks what files, scripts, or "
            "blueprints they have."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["code", "blueprints", "all"],
                    "description": (
                        "Which category to list: 'code' for Python scripts, "
                        "'blueprints' for .jarvis blueprints, or 'all' for both."
                    ),
                    "default": "all",
                },
            },
            "required": [],
        }

    # ------------------------------------------------------------------

    def execute(self, **kwargs: Any) -> ToolResult:
        category: str = kwargs.get("category", "all")

        if category not in ("code", "blueprints", "all"):
            category = "all"

        categories = (
            list(_CATEGORY_GLOBS.keys()) if category == "all" else [category]
        )

        sections: list[str] = []
        total = 0

        for cat in categories:
            cat_dir = _DATA_ROOT / cat
            if not cat_dir.exists():
                sections.append(f"📁 {cat}/  — directory does not exist")
                continue

            entries = self._list_category(cat, cat_dir)
            total += len(entries)

            if not entries:
                sections.append(f"📁 {cat}/  — empty")
                continue

            header = f"📁 {cat}/  ({len(entries)} file(s))"
            lines = [header]
            for e in entries:
                lines.append(f"  • {e}")
            sections.append("\n".join(lines))

        if total == 0:
            return ToolResult.ok_result(
                "The data directory is empty — no scripts or blueprints yet."
            )

        return ToolResult.ok_result("\n\n".join(sections))

    # ------------------------------------------------------------------

    @staticmethod
    def _list_category(cat: str, cat_dir: Path) -> list[str]:
        """Return one-line summaries per file in *cat_dir*."""
        globs = _CATEGORY_GLOBS.get(cat, ["*"])
        files: list[Path] = []
        for g in globs:
            files.extend(sorted(cat_dir.glob(g)))

        entries: list[str] = []
        for fp in files:
            size = fp.stat().st_size
            size_str = (
                f"{size} B"
                if size < 1024
                else f"{size / 1024:.1f} KB"
            )

            if cat == "blueprints":
                entries.append(_blueprint_summary(fp, size_str))
            elif cat == "code":
                entries.append(_code_summary(fp, size_str))
            else:
                entries.append(f"{fp.name}  ({size_str})")

        return entries


def _blueprint_summary(fp: Path, size_str: str) -> str:
    """One-line summary for a blueprint file."""
    try:
        data = json.loads(fp.read_text(encoding="utf-8"))
        display = data.get("name", fp.stem)
        bp_type = data.get("type", "unknown")
        comps = len(data.get("components", []))
        desc = data.get("description", "")
        summary = f"{display} ({fp.name}, {size_str})  —  type: {bp_type}, {comps} component(s)"
        if desc:
            summary += f"  — {desc}"
        return summary
    except Exception:
        return f"{fp.name}  ({size_str})  — ⚠ could not parse"


def _code_summary(fp: Path, size_str: str) -> str:
    """One-line summary for a Python script: first docstring or first comment."""
    try:
        text = fp.read_text(encoding="utf-8")
    except Exception:
        return f"{fp.name}  ({size_str})  — ⚠ could not read"

    lines = text.splitlines()
    # Try to extract first docstring or comment
    hint = ""
    for line in lines[:15]:
        stripped = line.strip()
        if stripped.startswith("#") and not stripped.startswith("#!"):
            hint = stripped.lstrip("# ").strip()
            break
        if stripped.startswith(('"""', "'''")):
            hint = stripped.strip("\"' ").strip()
            break
    if hint:
        # Truncate long hints
        if len(hint) > 60:
            hint = hint[:57] + "..."
        return f"{fp.name}  ({size_str})  — {hint}"
    return f"{fp.name}  ({size_str})"
