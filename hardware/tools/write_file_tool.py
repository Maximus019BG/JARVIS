"""Write file tool with security validation.

Provides secure file writing capabilities with:
- Path validation and sanitization
- Atomic writes with backup
- Size limits
- Audit logging
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolError
from core.security import SecurityManager, get_security_manager
from app_logging.logger import get_logger

logger = get_logger(__name__)


class WriteFileTool(BaseTool):
    """Tool for writing file contents securely.

    Implements:
    - Path validation
    - Atomic writes (via temp file + rename)
    - Automatic backup creation
    - Encoding handling
    """

    def __init__(
        self,
        security_manager: SecurityManager | None = None,
    ) -> None:
        self._security = security_manager or get_security_manager()

    @property
    def name(self) -> str:
        return "write_file"

    @property
    def description(self) -> str:
        return (
            "Write content to a file. Creates the file if it doesn't exist. "
            "Can optionally create a backup of existing files. "
            "Use this to save configurations, documents, or any text content."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to write (relative or absolute)",
                },
                "content": {
                    "type": "string",
                    "description": "Content to write to the file",
                },
                "encoding": {
                    "type": "string",
                    "description": "Character encoding (default: utf-8)",
                    "default": "utf-8",
                },
                "create_backup": {
                    "type": "boolean",
                    "description": "Create a backup of existing file (default: true)",
                    "default": True,
                },
                "append": {
                    "type": "boolean",
                    "description": "Append to file instead of overwriting (default: false)",
                    "default": False,
                },
            },
            "required": ["path", "content"],
        }

    def execute(
        self,
        path: str,
        content: str,
        encoding: str = "utf-8",
        create_backup: bool = True,
        append: bool = False,
        **kwargs: Any,
    ) -> str:
        """Write content to a file.

        Args:
            path: Path to the file to write.
            content: Content to write.
            encoding: Character encoding for writing.
            create_backup: Whether to create a backup of existing file.
            append: Whether to append instead of overwrite.

        Returns:
            Success message with file path.

        Raises:
            ToolError: If the file cannot be written.
        """
        try:
            # Validate and resolve path
            resolved_path = self._security.validate_file_access(path)

            # Ensure parent directory exists
            resolved_path.parent.mkdir(parents=True, exist_ok=True)

            # Create backup if file exists and backup is requested
            backup_path = None
            if create_backup and resolved_path.exists() and not append:
                backup_path = self._create_backup(resolved_path)

            # Write file atomically or append
            if append:
                self._append_file(resolved_path, content, encoding)
            else:
                self._write_atomic(resolved_path, content, encoding)

            # Audit log
            self._security.audit_log(
                "file_write",
                {
                    "path": str(resolved_path),
                    "encoding": encoding,
                    "size": len(content),
                    "append": append,
                    "backup": str(backup_path) if backup_path else None,
                },
            )

            msg = f"Successfully wrote {len(content)} characters to {path}"
            if backup_path:
                msg += f" (backup: {backup_path.name})"

            logger.info("Wrote file: %s (%d chars)", resolved_path, len(content))
            return msg

        except ToolError:
            raise
        except PermissionError as e:
            raise ToolError(f"Permission denied: {path}") from e
        except Exception as e:
            logger.exception("Error writing file: %s", path)
            raise ToolError(f"Failed to write file: {e}") from e

    def _create_backup(self, path: Path) -> Path:
        """Create a backup of an existing file.

        Args:
            path: Path to the file to backup.

        Returns:
            Path to the backup file.
        """
        backup_path = path.with_suffix(f"{path.suffix}.backup")

        # If backup already exists, add timestamp
        if backup_path.exists():
            import time

            timestamp = int(time.time())
            backup_path = path.with_suffix(f"{path.suffix}.{timestamp}.backup")

        shutil.copy2(path, backup_path)
        logger.debug("Created backup: %s", backup_path)
        return backup_path

    def _write_atomic(self, path: Path, content: str, encoding: str) -> None:
        """Write content atomically using temp file and rename.

        This ensures the file is never in a partially-written state.

        Args:
            path: Target file path.
            content: Content to write.
            encoding: Character encoding.
        """
        # Write to temp file in same directory (for same-filesystem rename)
        fd, temp_path = tempfile.mkstemp(
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
        )

        try:
            with open(fd, "w", encoding=encoding) as f:
                f.write(content)

            # Atomic rename
            Path(temp_path).replace(path)

        except Exception:
            # Cleanup temp file on failure
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass
            raise

    def _append_file(self, path: Path, content: str, encoding: str) -> None:
        """Append content to a file.

        Args:
            path: Target file path.
            content: Content to append.
            encoding: Character encoding.
        """
        with path.open("a", encoding=encoding) as f:
            f.write(content)
