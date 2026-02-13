"""Shell command tool for executing system commands.

Safe-by-default execution model:
- Prefer structured invocation: program + args (list[str])
- Always uses subprocess with shell=False
- Enforces allowlist policy + blocks shell metacharacters
- Routes cwd/path operands through SecurityManager validation

Notes (Windows/cmd.exe):
- cmd built-ins like `dir` cannot be executed without a shell; this tool will not
  route through `cmd /c` and will therefore fail naturally for such built-ins.
"""

from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path
from typing import Any, Iterable

from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolError, ToolResult
from core.security import get_security_manager

logger = get_logger(__name__)


class ShellCommandTool(BaseTool):
    """Tool for executing a highly restricted set of shell commands."""

    # ===== Policy knobs (intentionally small allowlist) =====
    # Safe, low-risk commands (may still fail if not available on OS).
    ALLOWED_COMMANDS = {
        "echo",
        "ls",
        "cat",
        "type",  # Windows equivalent of cat (external on some setups)
        "python",
        "pip",
    }

    # Specific (program, args-prefix) allowlist for commands that must be constrained.
    # If a program appears here, its argv must match one of these patterns.
    # Patterns are tuples of args (excluding argv[0]); use () to mean no args.
    ALLOWED_ARGV_PATTERNS: dict[str, set[tuple[str, ...]]] = {
        "python": {("--version",), ("-V",)},
        "pip": {("--version",), ("-V",)},
    }

    # Commands explicitly blocked (defense-in-depth).
    # Includes shells, network tools, package managers, destructive ops.
    BLOCKED_COMMANDS = {
        # Shells / interpreters / command launchers
        "cmd",
        "powershell",
        "pwsh",
        "bash",
        "sh",
        # Network / downloaders
        "curl",
        "wget",
        # Package managers (broader than pip)
        "npm",
        "yarn",
        "pnpm",
        "apt",
        "apt-get",
        "brew",
        "choco",
        "winget",
        # Destructive / system tools
        "del",
        "erase",
        "rm",
        "rmdir",
        "reg",
        "shutdown",
        "reboot",
        "poweroff",
        "mkfs",
        "dd",
        "chmod",
        "chown",
    }

    # Shell metacharacters / control tokens we reject in legacy raw string or any arg.
    FORBIDDEN_TOKENS = {
        "&",
        "|",
        ">",
        "<",
        ";",
        "&&",
        "||",
        "`",
        "$(",
        "${",
        "\n",
        "\r",
        "\x00",
    }

    # Windows variable expansion forms (defense-in-depth).
    _WIN_VAR_EXPANSION_CHARS = {"%", "!"}

    def __init__(
        self,
        timeout: int = 30,
        max_output: int = 10000,
    ) -> None:
        self.timeout = timeout
        self.max_output = max_output
        self._security = get_security_manager()

    @property
    def name(self) -> str:
        return "shell_command"

    @property
    def description(self) -> str:
        allow = ", ".join(sorted(self.ALLOWED_COMMANDS))
        return (
            "Execute a restricted shell command and return the output. "
            "Prefer structured invocation via program+args; legacy raw command is "
            "supported but strictly validated. "
            f"Allowed programs: {allow}."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "program": {
                    "type": "string",
                    "description": "Executable/program name (preferred).",
                },
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Arguments list for the program (preferred).",
                    "default": [],
                },
                "cwd": {
                    "type": "string",
                    "description": "Working directory (preferred).",
                },
                "command": {
                    "type": "string",
                    "description": "DEPRECATED: raw command string (strictly validated).",
                },
                "working_dir": {
                    "type": "string",
                    "description": "DEPRECATED alias for cwd.",
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "Optional per-call timeout (seconds).",
                },
                "max_output": {
                    "type": "integer",
                    "description": "Optional per-call output truncation limit.",
                },
            },
            # Back-compat: callers historically used `command`.
            "required": [],
        }

    def _contains_forbidden_token(self, value: str) -> bool:
        return any(tok in value for tok in self.FORBIDDEN_TOKENS)

    def _validate_program_name(self, program: str) -> str | None:
        if not program or not program.strip():
            return "Empty program"

        if any(ch.isspace() for ch in program):
            return "Program must not contain whitespace"

        base = os.path.basename(program)
        base = os.path.splitext(base)[0]  # tolerate `python.exe`
        base = base.lower()

        if base in self.BLOCKED_COMMANDS:
            return f"Program '{base}' is blocked for security reasons"

        if base not in self.ALLOWED_COMMANDS:
            return f"Program '{base}' is not in the allowed list"

        return None

    def _validate_args(self, args: Iterable[str]) -> str | None:
        for a in args:
            if not isinstance(a, str):
                return "All args must be strings"
            if self._contains_forbidden_token(a):
                return "Argument contains forbidden shell control/expansion tokens"
            if os.name == "nt" and any(ch in a for ch in self._WIN_VAR_EXPANSION_CHARS):
                # Defense-in-depth: avoid cmd.exe style expansions ever getting involved.
                return (
                    "Argument contains forbidden Windows variable expansion characters"
                )
        return None

    def _parse_legacy_command(self, command: str) -> tuple[str, list[str], str | None]:
        """Parse legacy raw command into (program, args) with strict validation."""
        if not command or not command.strip():
            return "", [], "Empty command"

        # Reject metacharacters early (raw string includes them even if split).
        if self._contains_forbidden_token(command):
            return "", [], "Command contains forbidden shell control/expansion tokens"

        # shlex on Windows is heuristic, but legacy mode is best-effort.
        try:
            parts = shlex.split(command, posix=os.name != "nt")
        except ValueError as e:
            return "", [], f"Invalid command syntax: {e}"

        if not parts:
            return "", [], "Empty command"

        program = parts[0]
        args = parts[1:]
        program_err = self._validate_program_name(program)
        if program_err:
            return "", [], program_err

        args_err = self._validate_args(args)
        if args_err:
            return "", [], args_err

        return program, list(args), None

    def _validate_argv_pattern(self, program_base: str, args: list[str]) -> str | None:
        patterns = self.ALLOWED_ARGV_PATTERNS.get(program_base)
        if not patterns:
            return None
        if tuple(args) not in patterns:
            return (
                f"Program '{program_base}' is only allowed with one of: "
                f"{sorted(patterns)}"
            )
        return None

    def _validate_and_resolve_cwd(
        self, cwd: str | None
    ) -> tuple[str | None, str | None]:
        if not cwd:
            return None, None
        try:
            resolved = self._security.validate_file_access(cwd)
        except Exception as e:
            return None, str(e)
        if not resolved.is_dir():
            return None, "Working directory must be a directory"
        return str(resolved), None

    def _validate_path_operands(
        self, program_base: str, args: list[str], cwd: str | None
    ) -> str | None:
        """Conservatively validate path-like operands via SecurityManager.

        For file-reading utilities, treat any non-flag arg as a path.
        For others (echo, python --version, pip --version), no path args.
        """
        path_programs = {"cat", "type", "ls"}
        if program_base not in path_programs:
            return None

        # For `ls`, allow `-a/-l` style flags; for `cat/type`, flags also exist.
        for a in args:
            if not a or a.startswith("-"):
                continue
            # Skip obvious non-path operands for `echo` etc (not in path_programs).
            candidate = a
            try:
                candidate_path = Path(candidate)
                if not candidate_path.is_absolute() and cwd:
                    candidate_path = Path(cwd) / candidate_path
                # validate_file_access expects str/path.
                self._security.validate_file_access(str(candidate_path))
            except Exception as e:
                return f"Path operand not allowed: {e}"
        return None

    def execute(
        self,
        program: str | None = None,
        args: list[str] | None = None,
        cwd: str | None = None,
        command: str | None = None,
        working_dir: str | None = None,
        timeout_seconds: int | None = None,
        max_output: int | None = None,
    ) -> ToolResult:
        """Execute a restricted command.

        Back-compat:
        - Prefer (program,args). If absent, falls back to legacy `command`.
        - `cwd` and `working_dir` are aliases; `cwd` wins.
        """
        effective_cwd = cwd or working_dir
        effective_timeout = (
            int(timeout_seconds) if timeout_seconds is not None else int(self.timeout)
        )
        effective_max_output = (
            int(max_output) if max_output is not None else int(self.max_output)
        )

        # Basic bounds to avoid abuse.
        if effective_timeout <= 0 or effective_timeout > 60:
            return ToolResult.fail(
                "timeout_seconds must be between 1 and 60", error_type="ValidationError"
            )
        if effective_max_output <= 0 or effective_max_output > 100_000:
            return ToolResult.fail(
                "max_output must be between 1 and 100000", error_type="ValidationError"
            )

        # Build argv
        if program is not None:
            args_list = list(args or [])
            program_err = self._validate_program_name(program)
            if program_err:
                logger.warning("Blocked program: %s - %s", program, program_err)
                return ToolResult.fail(
                    f"Command not allowed: {program_err}",
                    error_type="SecurityViolation",
                )
            args_err = self._validate_args(args_list)
            if args_err:
                logger.warning("Blocked args for %s: %s", program, args_err)
                return ToolResult.fail(
                    f"Command not allowed: {args_err}", error_type="SecurityViolation"
                )
            program_base = os.path.splitext(os.path.basename(program))[0].lower()
            pattern_err = self._validate_argv_pattern(program_base, args_list)
            if pattern_err:
                logger.warning(
                    "Blocked argv pattern for %s: %s", program_base, pattern_err
                )
                return ToolResult.fail(
                    f"Command not allowed: {pattern_err}",
                    error_type="SecurityViolation",
                )
        else:
            # Legacy mode
            if not command:
                return ToolResult.fail(
                    "Provide either program+args (preferred) or command (deprecated).",
                    error_type="ValidationError",
                )
            program, args_list, err = self._parse_legacy_command(command)
            if err:
                logger.warning("Blocked legacy command: %s - %s", command, err)
                return ToolResult.fail(
                    f"Command not allowed: {err}", error_type="SecurityViolation"
                )
            program_base = os.path.splitext(os.path.basename(program))[0].lower()
            pattern_err = self._validate_argv_pattern(program_base, args_list)
            if pattern_err:
                logger.warning(
                    "Blocked argv pattern for %s: %s", program_base, pattern_err
                )
                return ToolResult.fail(
                    f"Command not allowed: {pattern_err}",
                    error_type="SecurityViolation",
                )

        # Validate cwd via SecurityManager
        resolved_cwd, cwd_err = self._validate_and_resolve_cwd(effective_cwd)
        if cwd_err:
            return ToolResult.fail(
                f"Working directory not allowed: {cwd_err}", error_type="AccessDenied"
            )

        # Validate path operands
        path_err = self._validate_path_operands(program_base, args_list, resolved_cwd)
        if path_err:
            logger.warning("Blocked path operand: %s", path_err)
            return ToolResult.fail(
                f"Command not allowed: {path_err}", error_type="SecurityViolation"
            )

        argv = [program] + args_list

        try:
            result = subprocess.run(
                argv,
                shell=False,
                capture_output=True,
                text=True,
                timeout=effective_timeout,
                cwd=resolved_cwd,
            )

            output_parts = []

            if result.stdout:
                stdout = result.stdout
                if len(stdout) > effective_max_output:
                    stdout = stdout[:effective_max_output] + "\n[Output truncated...]"
                output_parts.append(f"**Output:**\n```\n{stdout}\n```")

            if result.stderr:
                stderr = result.stderr
                if len(stderr) > effective_max_output:
                    stderr = stderr[:effective_max_output] + "\n[Output truncated...]"
                output_parts.append(f"**Errors:**\n```\n{stderr}\n```")

            if result.returncode != 0:
                output_parts.append(f"**Exit code:** {result.returncode}")

            if not output_parts:
                output_parts.append("Command executed successfully (no output)")

            logger.info("Executed command: %s", argv)
            return ToolResult.ok_result("\n\n".join(output_parts))

        except subprocess.TimeoutExpired:
            logger.warning("Command timed out: %s", argv)
            return ToolResult.fail(
                f"Command timed out after {effective_timeout} seconds",
                error_type="Timeout",
            )
        except Exception as e:
            logger.error(f"Command execution failed: {e}")
            raise ToolError(f"Command failed: {e}") from e


class ListDirectoryTool(BaseTool):
    """Tool for listing directory contents."""

    def __init__(self) -> None:
        self._security = get_security_manager()

    @property
    def name(self) -> str:
        return "list_directory"

    @property
    def description(self) -> str:
        return "List the contents of a directory."

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the directory to list (default: current directory)",
                    "default": ".",
                },
                "show_hidden": {
                    "type": "boolean",
                    "description": "Whether to show hidden files",
                    "default": False,
                },
                "detailed": {
                    "type": "boolean",
                    "description": "Whether to show detailed information",
                    "default": False,
                },
            },
            "required": [],
        }

    def execute(
        self,
        path: str = ".",
        show_hidden: bool = False,
        detailed: bool = False,
    ) -> ToolResult:
        """List directory contents.

        Args:
            path: Directory path.
            show_hidden: Include hidden files.
            detailed: Show detailed info.

        Returns:
            Directory listing.
        """
        from pathlib import Path as FilePath

        try:
            dir_path = FilePath(path).resolve()

            # Validate path
            try:
                self._security.validate_file_access(str(dir_path))
            except Exception as e:
                return ToolResult.fail(f"Access denied: {e}", error_type="AccessDenied")

            if not dir_path.exists():
                return ToolResult.fail(
                    f"Directory not found: {path}", error_type="NotFound"
                )

            if not dir_path.is_dir():
                return ToolResult.fail(
                    f"Not a directory: {path}", error_type="ValidationError"
                )

            entries = []
            for entry in sorted(dir_path.iterdir()):
                name = entry.name

                # Skip hidden files unless requested
                if not show_hidden and name.startswith("."):
                    continue

                if detailed:
                    stat = entry.stat()
                    size = stat.st_size
                    if size < 1024:
                        size_str = f"{size}B"
                    elif size < 1024 * 1024:
                        size_str = f"{size // 1024}KB"
                    else:
                        size_str = f"{size // (1024 * 1024)}MB"

                    type_indicator = "📁" if entry.is_dir() else "📄"
                    entries.append(f"{type_indicator} {name:<40} {size_str:>10}")
                else:
                    if entry.is_dir():
                        entries.append(f"📁 {name}/")
                    else:
                        entries.append(f"📄 {name}")

            if not entries:
                return ToolResult.ok_result(f"Directory is empty: {path}")

            header = f"## Contents of: {dir_path}\n"
            return ToolResult.ok_result(header + "\n".join(entries))

        except PermissionError:
            return ToolResult.fail(
                f"Permission denied: {path}", error_type="AccessDenied"
            )
        except Exception as e:
            logger.error(f"Failed to list directory: {e}")
            raise ToolError(f"Failed to list directory: {e}") from e
