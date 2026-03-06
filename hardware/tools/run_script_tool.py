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
from core.sync.async_bridge import run_coro_sync
from core.sync.sync_factory import build_sync_stack

logger = get_logger(__name__)


class RunScriptTool(BaseTool):
    """Create and optionally run a Python script."""

    @property
    def name(self) -> str:
        return "run_script"

    @property
    def description(self) -> str:
        return (
            "Create a new Python script OR open and run an existing one. "
            "To CREATE: provide both 'name' and 'code'. "
            "To OPEN/RUN an existing script: provide only 'name' (no 'code'). "
            "Scripts live in data/code/<name>.py. "
            "Use this when the user asks to write, create, open, run, "
            "or execute a Python script/program."
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
                    "description": (
                        "The full Python source code for the script. "
                        "OMIT this to open and run an existing script by name."
                    ),
                },
                "run": {
                    "type": "boolean",
                    "description": "Whether to execute the script after saving. Default true.",
                    "default": True,
                },
            },
            "required": ["name"],
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

        from core.code.engine import CodeEngine

        engine = CodeEngine()

        # ── Create vs. Open existing ──────────────────────────────
        if code:
            # New script: save then optionally run
            path = engine.save_script(script_name, code)
            action = "created"
        else:
            # Open existing script by name
            loaded = engine.load_script(script_name)
            if not loaded:
                # Try with .py suffix
                loaded = engine.load_script(f"{script_name}.py")
            if not loaded:
                return ToolResult.fail(
                    f"Script '{script_name}' not found in data/code/. "
                    f"Use list_data(category='code') to see available scripts.",
                    tool=self.name,
                    error_type="NotFound",
                )
            path = engine.state.file_path
            code = engine.state.source
            action = "opened"

        output = ""
        run_ok = True
        if should_run:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    result = pool.submit(
                        lambda: asyncio.run(engine.run_script(path))
                    ).result(timeout=60)
            else:
                result = asyncio.run(engine.run_script(path))

            output = result.combined_output
            run_ok = result.ok

        script_sync_status = "not_attempted"
        script_sync_error: str | None = None
        if code:
            try:
                stack = build_sync_stack()
                sync_response = run_coro_sync(
                    stack.sync_manager.send_script(str(path)),
                    timeout=90,
                )
                script_sync_status = str(sync_response.get("syncStatus", "synced"))
            except Exception as exc:
                script_sync_status = "queued"
                script_sync_error = str(exc)
                logger.warning(
                    "Script saved locally but immediate cloud sync failed; queued for retry: %s",
                    exc,
                )

        # Build a nice summary
        summary_lines = [f"Script {action}: {path}"]
        if should_run:
            status = "✓ Success" if run_ok else "✗ Error"
            summary_lines.append(f"Execution: {status}")
            summary_lines.append(f"Output:\n{output}")
        if script_sync_status == "synced":
            summary_lines.append("Cloud sync: synced")
        elif script_sync_status == "queued":
            summary_lines.append("Cloud sync: queued for retry")

        return ToolResult.ok_result(
            "\n".join(summary_lines),
            tool=self.name,
            # Signal TUI to open code pane
            open_code_engine=True,
            script_path=str(path),
            script_name=script_name,
            source=code,
            output=output,
            execution_ok=run_ok,
            sync_status=script_sync_status,
            sync_error=script_sync_error,
        )
