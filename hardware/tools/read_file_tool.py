"""Read file tool with security validation.

Provides secure file reading capabilities with:
- Path validation and sanitization
- Size limits
- Encoding support
- Audit logging
"""

from __future__ import annotations

# Standard library imports
import os
from pathlib import Path
from typing import Any

# Local application imports
from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolError, ToolResult
from core.security import SecurityManager, get_security_manager

logger = get_logger(__name__)


class ReadFileTool(BaseTool):
    """Tool for reading file contents securely.

    Implements path validation, size limits, and encoding handling.
    """

    def __init__(
        self,
        security_manager: SecurityManager | None = None,
    ) -> None:
        self._security = security_manager or get_security_manager()

    @property
    def name(self) -> str:
        return "read_file"

    @property
    def description(self) -> str:
        return (
            "Read the contents of a file. Returns the file content as text. "
            "Use this to read configuration files, documents, or any text file."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to read (relative or absolute)",
                },
                "encoding": {
                    "type": "string",
                    "description": "Character encoding (default: utf-8)",
                    "default": "utf-8",
                },
                "max_lines": {
                    "type": "integer",
                    "description": "Maximum number of lines to read (optional, reads all if not specified)",
                },
            },
            "required": ["path"],
        }

    def execute(
        self,
        path: str,
        encoding: str = "utf-8",
        max_lines: int | None = None,
        **kwargs: Any,
    ) -> ToolResult:
        """Read the contents of a file.

        Args:
            path: Path to the file to read.
            encoding: Character encoding for reading.
            max_lines: Maximum lines to read (None for all).

        Returns:
            The file contents as a string.

        Raises:
            ToolError: If the file cannot be read.
        """
        try:
            # Validate and resolve path
            resolved_path = self._security.validate_file_access(path)

            # Check file exists
            if not resolved_path.exists():
                raise ToolError(f"File not found: {path}")

            if not resolved_path.is_file():
                raise ToolError(f"Not a file: {path}")

            # Check file size
            self._security.validate_file_size(resolved_path)

            # Read file
            content = self._read_file(resolved_path, encoding, max_lines)

            # Audit log
            self._security.audit_log(
                "file_read",
                {
                    "path": str(resolved_path),
                    "encoding": encoding,
                    "size": len(content),
                },
            )

            logger.info("Read file: %s (%d chars)", resolved_path, len(content))
            return ToolResult.ok_result(content)

        except ToolError:
            raise
        except PermissionError as e:
            raise ToolError(f"Permission denied: {path}") from e
        except UnicodeDecodeError as e:
            raise ToolError(
                f"Failed to decode file with encoding '{encoding}': {e}"
            ) from e
        except Exception as e:
            logger.exception("Error reading file: %s", path)
            raise ToolError(f"Failed to read file: {e}") from e

    def _read_file(
        self,
        path: Path,
        encoding: str,
        max_lines: int | None,
    ) -> str:
        """Read file contents with optional line limit."""
        if max_lines is None:
            return path.read_text(encoding=encoding)

        lines = []
        with path.open("r", encoding=encoding) as f:
            for i, line in enumerate(f):
                if i >= max_lines:
                    lines.append(f"\n... (truncated after {max_lines} lines)")
                    break
                lines.append(line)

        return "".join(lines)
