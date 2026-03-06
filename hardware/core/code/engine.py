"""Code Engine – manages script files, execution, and output state.

Responsibilities:
- Save Python scripts to ``data/code/``
- Execute scripts in a subprocess with timeout
- Capture stdout/stderr
- Track current file + last output for the TUI widget
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app_logging.logger import get_logger

logger = get_logger(__name__)

CODE_DIR = Path("data/code")


@dataclass
class ExecutionResult:
    """Result of running a script."""

    ok: bool
    stdout: str
    stderr: str
    return_code: int
    timed_out: bool = False

    @property
    def combined_output(self) -> str:
        parts: list[str] = []
        if self.stdout:
            parts.append(self.stdout)
        if self.stderr:
            parts.append(self.stderr)
        if self.timed_out:
            parts.append("[timed out]")
        return "\n".join(parts) if parts else "(no output)"


@dataclass
class CodeEngineState:
    """Observable state the TUI widget renders."""

    file_path: Path | None = None
    file_name: str = ""
    source: str = ""
    output: str = ""
    is_running: bool = False
    last_result: ExecutionResult | None = None


class CodeEngine:
    """Manages Python script files under ``data/code/`` and runs them."""

    def __init__(self, code_dir: Path | None = None, timeout: int = 30) -> None:
        self.code_dir = (code_dir or CODE_DIR).resolve()
        self.code_dir.mkdir(parents=True, exist_ok=True)
        self.timeout = timeout
        self.state = CodeEngineState()

    # ── File helpers ──────────────────────────────────────────────

    def _sanitise_name(self, name: str) -> str:
        """Turn a human-friendly name into a safe filename stem."""
        name = name.strip().replace(" ", "_")
        # Keep only alphanumeric, underscore, hyphen
        safe = "".join(c for c in name if c.isalnum() or c in ("_", "-"))
        return safe or "script"

    def save_script(self, name: str, code: str) -> Path:
        """Write *code* to ``<code_dir>/<name>.py`` and update state."""
        stem = self._sanitise_name(name)
        if not stem.endswith(".py"):
            stem = f"{stem}.py"
        path = self.code_dir / stem
        path.write_text(code, encoding="utf-8")
        self.state.file_path = path
        self.state.file_name = stem
        self.state.source = code
        self.state.output = ""
        self.state.last_result = None
        logger.info("Saved script %s (%d bytes)", path, len(code))
        return path

    def load_script(self, path: str | Path) -> bool:
        """Load an existing script into the engine state."""
        p = Path(path)
        if not p.is_absolute():
            p = self.code_dir / p
        if not p.exists():
            logger.warning("Script not found: %s", p)
            return False
        self.state.file_path = p
        self.state.file_name = p.name
        self.state.source = p.read_text(encoding="utf-8")
        self.state.output = ""
        self.state.last_result = None
        return True

    def list_scripts(self) -> list[Path]:
        """List all ``.py`` files in the code directory."""
        return sorted(self.code_dir.glob("*.py"), key=lambda p: p.stat().st_mtime, reverse=True)

    # ── Execution ─────────────────────────────────────────────────

    async def run_script(self, path: str | Path | None = None) -> ExecutionResult:
        """Run a Python script in a subprocess.

        If *path* is ``None``, runs the currently loaded script.
        """
        p = Path(path) if path else self.state.file_path
        if p is None:
            return ExecutionResult(ok=False, stdout="", stderr="No script loaded.", return_code=-1)
        if not p.is_absolute():
            p = self.code_dir / p
        if not p.exists():
            return ExecutionResult(ok=False, stdout="", stderr=f"File not found: {p}", return_code=-1)

        self.state.is_running = True
        self.state.output = "Running…"

        python = sys.executable
        try:
            proc = await asyncio.create_subprocess_exec(
                python, str(p),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.code_dir),
            )
            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    proc.communicate(), timeout=self.timeout,
                )
                timed_out = False
            except asyncio.TimeoutError:
                proc.kill()
                stdout_bytes, stderr_bytes = b"", b""
                timed_out = True

            result = ExecutionResult(
                ok=proc.returncode == 0 and not timed_out,
                stdout=stdout_bytes.decode("utf-8", errors="replace").rstrip(),
                stderr=stderr_bytes.decode("utf-8", errors="replace").rstrip(),
                return_code=proc.returncode if proc.returncode is not None else -1,
                timed_out=timed_out,
            )
        except Exception as exc:
            result = ExecutionResult(
                ok=False, stdout="", stderr=str(exc), return_code=-1,
            )

        self.state.is_running = False
        self.state.output = result.combined_output
        self.state.last_result = result
        logger.info(
            "Script %s finished: rc=%d ok=%s output_len=%d",
            p.name, result.return_code, result.ok, len(result.combined_output),
        )
        return result

    async def run_inline(self, code: str, name: str = "inline") -> ExecutionResult:
        """Save code to a temp file and run it."""
        path = self.save_script(name, code)
        return await self.run_script(path)
