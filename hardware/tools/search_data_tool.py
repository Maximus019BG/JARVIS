"""Search inside data files (code scripts and blueprints) by keyword.

Lets the LLM find relevant existing work — e.g. "do I have a script that
uses pandas?" or "which blueprint has a battery?".
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult

_DATA_ROOT = Path("data")

_CATEGORY_GLOBS: dict[str, list[str]] = {
    "code": ["*.py"],
    "blueprints": ["*.jarvis", "*.json"],
}

# Max characters of file content to return per match
_MAX_SNIPPET_LEN = 400
# Max number of total matches to return (prevent huge outputs)
_MAX_MATCHES = 20


class SearchDataTool(BaseTool):
    """Search inside data files by keyword or pattern."""

    @property
    def name(self) -> str:
        return "search_data"

    @property
    def description(self) -> str:
        return (
            "Search inside saved code scripts and blueprints for a keyword "
            "or phrase. Returns matching filenames and relevant snippets. "
            "Use category to limit search to 'code', 'blueprints', or 'all'. "
            "Use this when the user asks about existing files, wants to find "
            "a script that does X, or asks which blueprint contains Y."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Keyword or phrase to search for inside files. "
                        "Case-insensitive. Supports simple text matching."
                    ),
                },
                "category": {
                    "type": "string",
                    "enum": ["code", "blueprints", "all"],
                    "description": (
                        "Where to search: 'code' for scripts, "
                        "'blueprints' for .jarvis files, or 'all'."
                    ),
                    "default": "all",
                },
            },
            "required": ["query"],
        }

    # ------------------------------------------------------------------

    def execute(self, **kwargs: Any) -> ToolResult:
        query: str = kwargs.get("query", "").strip()
        category: str = kwargs.get("category", "all")

        if not query:
            return ToolResult.fail(
                "A search query is required.",
                tool=self.name,
                error_type="MissingQuery",
            )

        if category not in ("code", "blueprints", "all"):
            category = "all"

        categories = (
            list(_CATEGORY_GLOBS.keys()) if category == "all" else [category]
        )

        try:
            pattern = re.compile(re.escape(query), re.IGNORECASE)
        except re.error:
            return ToolResult.fail(
                f"Invalid search query: {query!r}",
                tool=self.name,
                error_type="InvalidQuery",
            )

        results: list[str] = []
        match_count = 0

        for cat in categories:
            cat_dir = _DATA_ROOT / cat
            if not cat_dir.exists():
                continue

            globs = _CATEGORY_GLOBS.get(cat, ["*"])
            files: list[Path] = []
            for g in globs:
                files.extend(sorted(cat_dir.glob(g)))

            for fp in files:
                if match_count >= _MAX_MATCHES:
                    break

                matches = self._search_file(fp, pattern, cat)
                if matches:
                    results.append(matches)
                    match_count += 1

        if not results:
            return ToolResult.ok_result(
                f"No matches for '{query}' in {category} files."
            )

        header = f"Found {len(results)} file(s) matching '{query}':\n"
        return ToolResult.ok_result(header + "\n\n".join(results))

    # ------------------------------------------------------------------

    @staticmethod
    def _search_file(fp: Path, pattern: re.Pattern[str], cat: str) -> str | None:
        """Search a single file, return a formatted result or *None*."""
        try:
            text = fp.read_text(encoding="utf-8")
        except Exception:
            return None

        if not pattern.search(text):
            return None

        if cat == "blueprints":
            return _search_blueprint(fp, text, pattern)
        return _search_code(fp, text, pattern)


def _search_code(fp: Path, text: str, pattern: re.Pattern[str]) -> str:
    """Return matching lines from a Python script."""
    lines = text.splitlines()
    matching_lines: list[str] = []
    for i, line in enumerate(lines, start=1):
        if pattern.search(line):
            matching_lines.append(f"  L{i}: {line.rstrip()}")
        if len(matching_lines) >= 8:
            matching_lines.append("  ... (more matches)")
            break

    snippet = "\n".join(matching_lines)
    return f"📄 code/{fp.name}:\n{snippet}"


def _search_blueprint(fp: Path, text: str, pattern: re.Pattern[str]) -> str:
    """Return matching component/field info from a blueprint."""
    try:
        data = json.loads(text)
    except Exception:
        # Fall back to raw text search
        return f"📄 blueprints/{fp.name}: contains match (could not parse JSON)"

    hits: list[str] = []

    # Search top-level fields
    for key in ("name", "type", "description"):
        val = data.get(key, "")
        if isinstance(val, str) and pattern.search(val):
            hits.append(f"  {key}: {val}")

    # Search components
    for comp in data.get("components", []):
        comp_name = comp.get("name", comp.get("type", "?"))
        comp_str = json.dumps(comp, ensure_ascii=False)
        if pattern.search(comp_str):
            hits.append(f"  component: {comp_name}")

    # Search lines/connections
    for line_obj in data.get("lines", []):
        line_str = json.dumps(line_obj, ensure_ascii=False)
        if pattern.search(line_str):
            label = line_obj.get("label", "connection")
            hits.append(f"  line: {label}")

    if not hits:
        hits.append("  (match in raw content)")

    display = data.get("name", fp.stem)
    snippet = "\n".join(hits[:8])
    if len(hits) > 8:
        snippet += "\n  ... (more matches)"
    return f"📐 blueprints/{fp.name} ({display}):\n{snippet}"
