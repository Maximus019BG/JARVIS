"""Security manager for file access control, input sanitization, and audit logging.

Provides comprehensive security features:
- File path validation with allowlist/blocklist
- Path traversal attack prevention
- Input sanitization
- Rate limiting
- Audit logging
"""

from __future__ import annotations

import os
import re
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, Any

from app_logging.logger import get_logger

if TYPE_CHECKING:
    from config.config import SecurityConfig

logger = get_logger(__name__)


class SecurityError(Exception):
    """Raised when a security violation is detected."""


class RateLimiter:
    """Simple rate limiter using sliding window."""

    def __init__(
        self,
        max_requests: int = 100,
        window_seconds: int = 60,
    ) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def is_allowed(self, key: str = "default") -> bool:
        """Check if a request is allowed.

        Args:
            key: Identifier for rate limiting (e.g., user ID, IP)

        Returns:
            True if the request is allowed, False otherwise.
        """
        with self._lock:
            now = time.time()
            window_start = now - self.window_seconds

            # Clean old requests
            self._requests[key] = [
                t for t in self._requests[key] if t > window_start
            ]

            # Check limit
            if len(self._requests[key]) >= self.max_requests:
                return False

            # Record request
            self._requests[key].append(now)
            return True

    def reset(self, key: str = "default") -> None:
        """Reset the rate limiter for a key."""
        with self._lock:
            self._requests[key] = []


class SecurityManager:
    """Central security manager for the application.

    Handles:
    - File access validation
    - Input sanitization
    - Rate limiting
    - Audit logging
    """

    def __init__(self, config: SecurityConfig | None = None) -> None:
        from config.config import SecurityConfig

        self.config = config or SecurityConfig()
        self.rate_limiter = RateLimiter()
        self._audit_lock = Lock()

        # Resolve allowed and blocked paths to absolute paths
        self._allowed_paths = [
            Path(p).resolve() for p in self.config.allowed_paths if p
        ]
        self._blocked_paths = [
            Path(p).resolve() for p in self.config.blocked_paths if p
        ]

        logger.info(
            "SecurityManager initialized with level: %s",
            self.config.level.value,
        )

    def validate_file_access(self, path: str | Path) -> Path:
        """Validate and resolve a file path for access.

        Args:
            path: The path to validate.

        Returns:
            The resolved, validated path.

        Raises:
            SecurityError: If the path is not allowed.
        """
        try:
            # Resolve to absolute path
            resolved = Path(path).resolve()
        except Exception as e:
            raise SecurityError(f"Invalid path: {e}") from e

        # Check for path traversal attempts
        path_str = str(path)
        if ".." in path_str or path_str.startswith("~"):
            self.audit_log("path_traversal_attempt", {"path": path_str})
            raise SecurityError("Path traversal not allowed")

        # Check blocked paths first
        for blocked in self._blocked_paths:
            try:
                resolved.relative_to(blocked)
                self.audit_log("blocked_path_access", {"path": str(resolved)})
                raise SecurityError(f"Access to {blocked} is blocked")
            except ValueError:
                # Not relative to blocked path, continue
                pass

        # Check if path is in allowed paths
        is_allowed = False
        for allowed in self._allowed_paths:
            try:
                resolved.relative_to(allowed)
                is_allowed = True
                break
            except ValueError:
                continue

        if not is_allowed and self._allowed_paths:
            self.audit_log("unauthorized_path_access", {"path": str(resolved)})
            raise SecurityError(
                f"Path not in allowed directories: {resolved}"
            )

        return resolved

    def validate_file_size(self, path: Path) -> None:
        """Validate that a file is within size limits.

        Args:
            path: Path to the file to check.

        Raises:
            SecurityError: If the file exceeds size limits.
        """
        if not path.exists():
            return

        max_size = self.config.get_max_file_size_bytes()
        actual_size = path.stat().st_size

        if actual_size > max_size:
            self.audit_log(
                "file_size_exceeded",
                {"path": str(path), "size": actual_size, "max": max_size},
            )
            raise SecurityError(
                f"File size ({actual_size} bytes) exceeds limit "
                f"({max_size} bytes)"
            )

    def sanitize_input(self, input_str: str, allow_special: bool = False) -> str:
        """Sanitize user input by removing potentially dangerous characters.

        Args:
            input_str: The input string to sanitize.
            allow_special: If True, allows more special characters.

        Returns:
            The sanitized string.
        """
        if allow_special:
            # Allow more characters but still remove dangerous ones
            pattern = r'[<>"\';`\\|&$]'
        else:
            # Strict sanitization
            pattern = r"[^\w\s\-_.,!?@#%():\[\]]"

        return re.sub(pattern, "", input_str)

    def sanitize_filename(self, filename: str) -> str:
        """Sanitize a filename for safe file operations.

        Args:
            filename: The filename to sanitize.

        Returns:
            A safe filename.
        """
        # Remove path separators and other dangerous characters
        sanitized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", filename)
        # Remove leading/trailing dots and spaces
        sanitized = sanitized.strip(". ")
        # Ensure not empty
        if not sanitized:
            sanitized = "unnamed"
        return sanitized

    def check_rate_limit(self, key: str = "default") -> None:
        """Check if the rate limit allows the operation.

        Args:
            key: Identifier for rate limiting.

        Raises:
            SecurityError: If rate limit is exceeded.
        """
        if not self.rate_limiter.is_allowed(key):
            self.audit_log("rate_limit_exceeded", {"key": key})
            raise SecurityError("Rate limit exceeded. Please try again later.")

    def audit_log(
        self,
        action: str,
        details: dict[str, Any] | None = None,
        user: str = "system",
    ) -> None:
        """Write an entry to the audit log.

        Args:
            action: The action being logged.
            details: Additional details about the action.
            user: The user performing the action.
        """
        if not self.config.enable_audit_log:
            return

        with self._audit_lock:
            try:
                log_path = Path(self.config.audit_log_path)
                log_path.parent.mkdir(parents=True, exist_ok=True)

                timestamp = datetime.now().isoformat()
                log_entry = {
                    "timestamp": timestamp,
                    "action": action,
                    "user": user,
                    "details": details or {},
                }

                with log_path.open("a", encoding="utf-8") as f:
                    import json

                    f.write(json.dumps(log_entry) + "\n")

            except Exception as e:
                logger.error("Failed to write audit log: %s", e)

    def verify_plugin_signature(self, plugin_path: str | Path) -> bool:
        """Verify the signature of a plugin file.

        Note: This is a placeholder for actual signature verification.
        In production, implement proper cryptographic signature verification.

        Args:
            plugin_path: Path to the plugin file.

        Returns:
            True if the plugin is verified, False otherwise.
        """
        from config.config import SecurityLevel

        if self.config.level == SecurityLevel.LOW:
            logger.warning("Plugin signature verification skipped (low security)")
            return True

        # TODO: Implement actual signature verification
        # For now, log and allow in medium security, deny in high
        logger.warning(
            "Plugin signature verification not fully implemented for: %s",
            plugin_path,
        )

        if self.config.level == SecurityLevel.HIGH:
            self.audit_log(
                "plugin_verification_failed",
                {"path": str(plugin_path)},
            )
            return False

        return True


# Global security manager instance
_security_manager: SecurityManager | None = None


def get_security_manager() -> SecurityManager:
    """Get the global security manager instance."""
    global _security_manager
    if _security_manager is None:
        _security_manager = SecurityManager()
    return _security_manager


def set_security_manager(manager: SecurityManager) -> None:
    """Set the global security manager instance."""
    global _security_manager
    _security_manager = manager
