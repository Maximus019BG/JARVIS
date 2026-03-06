"""Run Script tool – LLM creates & runs Python scripts via the Code Engine.

The tool:
1. Accepts a script ``name`` and ``code`` from the LLM.
2. Saves the file to ``data/code/<name>.py``.
3. Optionally executes it and returns stdout/stderr.
4. Signals the TUI to open the Code Engine pane.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolResult

logger = get_logger(__name__)


class RunScriptTool(BaseTool):
    """Create and optionally run a Python script."""

    @property
    def name(self) -> str:
        return "run_script"

    @property
    def description(self) -> str:
        return (
            "Create a Python script file and optionally run it. "
            "The file is saved to data/code/<name>.py. "
            "Returns the source code and execution output. "
            "Use this when the user asks you to write, create, code, "
            "or run a Python script/program."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": (
                        "Script filename (without .py extension). "
                        "E.g. 'hello_world', 'fibonacci', 'calculator'."
                    ),
                },
                "code": {
                    "type": "string",
                    "description": "The full Python source code for the script.",
                },
                "run": {
                    "type": "boolean",
                    "description": "Whether to execute the script after saving. Default true.",
                    "default": True,
                },
            },
            "required": ["name", "code"],
        }

    def execute(self, **kwargs: Any) -> ToolResult:
        """Save and optionally run the script.

        Execution is async, so we bridge into the running event loop.
        """
        script_name: str = kwargs.get("name", "")
        code: str = kwargs.get("code", "")
        should_run: bool = kwargs.get("run", True)

        if not script_name:
            return ToolResult.fail(
                "Script name is required.",
                tool=self.name,
                error_type="MissingName",
            )
        if not code:
            return ToolResult.fail(
                "Code is required.",
                tool=self.name,
                error_type="MissingCode",
            )

        from core.code.engine import CodeEngine

        engine = CodeEngine()
        path = engine.save_script(script_name, code)

        output = ""
        run_ok = True
        if should_run:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                # We're inside an async context (TUI) — use a thread
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    result = pool.submit(
                        lambda: asyncio.run(engine.run_script(path))
                    ).result(timeout=60)
            else:
                result = asyncio.run(engine.run_script(path))

            output = result.combined_output
            run_ok = result.ok

        # Build a nice summary
        lines = [f"Script saved: {path}"]
        if should_run:
            status = "✓ Success" if run_ok else "✗ Error"
            lines.append(f"Execution: {status}")
            lines.append(f"Output:\n{output}")

        return ToolResult.ok_result(
            "\n".join(lines),
            tool=self.name,
            # Signal TUI to open code pane
            open_code_engine=True,
            script_path=str(path),
            script_name=script_name,
            source=code,
            output=output,
            execution_ok=run_ok,
        )
