"""Shell command tool for executing system commands.

Provides controlled shell command execution with:
- Command allowlist
- Timeout limits
- Output capture
- Security restrictions
"""

from __future__ import annotations

import shlex
import subprocess
from typing import Any

from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolError
from core.security import get_security_manager

logger = get_logger(__name__)


class ShellCommandTool(BaseTool):
    """Tool for executing shell commands.

    Only allows a predefined set of safe commands.
    """

    # Commands that are safe to execute
    ALLOWED_COMMANDS = {
        "ls",
        "dir",
        "pwd",
        "echo",
        "cat",
        "head",
        "tail",
        "wc",
        "grep",
        "find",
        "which",
        "whoami",
        "date",
        "cal",
        "uptime",
        "df",
        "du",
        "free",
        "uname",
        "hostname",
        "env",
        "printenv",
        "tree",
        "file",
        "stat",
        "md5sum",
        "sha256sum",
        "sort",
        "uniq",
        "cut",
        "awk",
        "sed",
        "tr",
        "diff",
        "comm",
        "tee",
        "xargs",
    }

    # Commands that are explicitly blocked
    BLOCKED_COMMANDS = {
        "rm",
        "rmdir",
        "mv",
        "cp",
        "chmod",
        "chown",
        "kill",
        "pkill",
        "killall",
        "shutdown",
        "reboot",
        "halt",
        "poweroff",
        "sudo",
        "su",
        "passwd",
        "useradd",
        "userdel",
        "usermod",
        "groupadd",
        "groupdel",
        "mount",
        "umount",
        "fdisk",
        "mkfs",
        "dd",
        "wget",
        "curl",
        "ssh",
        "scp",
        "rsync",
        "nc",
        "netcat",
        "nmap",
        "iptables",
        "systemctl",
        "service",
    }

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
        return (
            "Execute a shell command and return the output. "
            "Only safe, read-only commands are allowed. "
            f"Allowed commands include: {', '.join(sorted(list(self.ALLOWED_COMMANDS)[:15]))}..."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute",
                },
                "working_dir": {
                    "type": "string",
                    "description": "Working directory for the command (optional)",
                },
            },
            "required": ["command"],
        }

    def _is_command_allowed(self, command: str) -> tuple[bool, str]:
        """Check if a command is allowed.

        Args:
            command: The command to check.

        Returns:
            Tuple of (is_allowed, reason).
        """
        try:
            # Parse the command
            parts = shlex.split(command)
            if not parts:
                return False, "Empty command"

            base_command = parts[0].split("/")[-1]  # Get basename

            # Check blocked list first
            if base_command in self.BLOCKED_COMMANDS:
                return False, f"Command '{base_command}' is blocked for security reasons"

            # Check allowed list
            if base_command not in self.ALLOWED_COMMANDS:
                return False, f"Command '{base_command}' is not in the allowed list"

            # Check for dangerous patterns in arguments
            dangerous_patterns = [
                "$(", "`", "&&", "||", ";", "|", ">", "<", ">>", "<<",
                "/dev/", "/proc/", "/sys/", "/etc/passwd", "/etc/shadow",
            ]

            for pattern in dangerous_patterns:
                if pattern in command:
                    # Allow pipes for safe commands
                    if pattern == "|":
                        # Validate piped command too
                        pipe_parts = command.split("|")
                        for part in pipe_parts[1:]:
                            part = part.strip()
                            if part:
                                sub_parts = shlex.split(part)
                                if sub_parts:
                                    sub_cmd = sub_parts[0].split("/")[-1]
                                    if sub_cmd not in self.ALLOWED_COMMANDS:
                                        return False, f"Piped command '{sub_cmd}' not allowed"
                        continue
                    return False, f"Pattern '{pattern}' is not allowed"

            return True, "Command allowed"

        except ValueError as e:
            return False, f"Invalid command syntax: {e}"

    def execute(
        self,
        command: str = "",
        working_dir: str | None = None,
    ) -> str:
        """Execute shell command.

        Args:
            command: Command to execute.
            working_dir: Working directory.

        Returns:
            Command output.
        """
        if not command.strip():
            return "Please provide a command to execute."

        # Check if command is allowed
        allowed, reason = self._is_command_allowed(command)
        if not allowed:
            logger.warning(f"Blocked command: {command} - {reason}")
            return f"Command not allowed: {reason}"

        # Validate working directory if provided
        if working_dir:
            validation = self._security.validate_path(working_dir)
            if not validation.is_allowed:
                return f"Working directory not allowed: {validation.reason}"

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                cwd=working_dir,
            )

            output_parts = []

            if result.stdout:
                stdout = result.stdout
                if len(stdout) > self.max_output:
                    stdout = stdout[: self.max_output] + "\n[Output truncated...]"
                output_parts.append(f"**Output:**\n```\n{stdout}\n```")

            if result.stderr:
                stderr = result.stderr
                if len(stderr) > self.max_output:
                    stderr = stderr[: self.max_output] + "\n[Output truncated...]"
                output_parts.append(f"**Errors:**\n```\n{stderr}\n```")

            if result.returncode != 0:
                output_parts.append(f"**Exit code:** {result.returncode}")

            if not output_parts:
                output_parts.append("Command executed successfully (no output)")

            logger.info(f"Executed command: {command}")
            return "\n\n".join(output_parts)

        except subprocess.TimeoutExpired:
            logger.warning(f"Command timed out: {command}")
            return f"Command timed out after {self.timeout} seconds"
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
    ) -> str:
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
            validation = self._security.validate_path(str(dir_path))
            if not validation.is_allowed:
                return f"Access denied: {validation.reason}"

            if not dir_path.exists():
                return f"Directory not found: {path}"

            if not dir_path.is_dir():
                return f"Not a directory: {path}"

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
                return f"Directory is empty: {path}"

            header = f"## Contents of: {dir_path}\n"
            return header + "\n".join(entries)

        except PermissionError:
            return f"Permission denied: {path}"
        except Exception as e:
            logger.error(f"Failed to list directory: {e}")
            raise ToolError(f"Failed to list directory: {e}") from e
