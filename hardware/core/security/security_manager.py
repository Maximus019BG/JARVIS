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
from urllib.parse import unquote

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
        """Initialize the rate limiter.

        Args:
            max_requests: Maximum number of requests allowed in the time window.
            window_seconds: Time window in seconds for rate limiting.
        """
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
        """Initialize the security manager.

        Args:
            config: Security configuration. If None, loads from environment.
        """
        from config.config import SecurityConfig

        self.config = config or SecurityConfig()
        self.rate_limiter = RateLimiter(
            max_requests=self.config.rate_limit_max_requests,
            window_seconds=self.config.rate_limit_window_seconds,
        )
        self._audit_lock = Lock()

        # Resolve allowed and blocked paths to absolute paths
        self._allowed_paths = [
            Path(p).resolve() for p in self.config.allowed_paths if p
        ]
        self._blocked_paths = [
            Path(p).resolve() for p in self.config.blocked_paths if p
        ]

        # Load trusted public key for plugin signature verification
        self._public_key = self._load_public_key()

        logger.info(
            "SecurityManager initialized with level: %s",
            self.config.level.value,
        )

    def _load_public_key(self) -> Any:
        """Load the trusted public key for plugin signature verification.

        Returns:
            The public key object or None if not configured.
        """
        try:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric import rsa
            from cryptography.hazmat.backends import default_backend

            # Try to load from environment variable or file
            public_key_path = os.getenv("PLUGIN_PUBLIC_KEY_PATH")
            if public_key_path and Path(public_key_path).exists():
                with open(public_key_path, "rb") as f:
                    public_key = serialization.load_pem_public_key(
                        f.read(), backend=default_backend()
                    )
                logger.info("Loaded public key from: %s", public_key_path)
                return public_key
        except Exception as e:
            logger.warning("Failed to load public key: %s", e)

        return None

    def validate_file_access(self, path: str | Path) -> Path:
        """Validate and resolve a file path for access.

        Args:
            path: The path to validate.

        Returns:
            The resolved, validated path.

        Raises:
            SecurityError: If the path is not allowed.
        """
        # Decode URL-encoded paths to catch encoded traversal attempts
        if isinstance(path, str):
            path = unquote(path)

        try:
            # Resolve to absolute canonical path (handles symlinks)
            resolved = Path(path).resolve()
        except Exception as e:
            raise SecurityError(f"Invalid path: {e}") from e

        # Check for path traversal attempts by comparing resolved path
        # against allowed directories. This catches all forms of traversal
        # including encoded variants and symlinks.
        is_allowed = False
        for allowed in self._allowed_paths:
            try:
                resolved.relative_to(allowed)
                is_allowed = True
                break
            except ValueError:
                continue

        # If not in allowed paths, check if it's a traversal attempt
        if not is_allowed and self._allowed_paths:
            # Check if the original path contains suspicious patterns
            path_str = str(path)
            suspicious_patterns = ["..", "~", "%2e%2e", "%2E%2E", "%252e"]
            if any(pattern in path_str for pattern in suspicious_patterns):
                self.audit_log(
                    "path_traversal_attempt",
                    {"original_path": path_str, "resolved_path": str(resolved)},
                )
                raise SecurityError("Path traversal not allowed")

            self.audit_log("unauthorized_path_access", {"path": str(resolved)})
            raise SecurityError(
                f"Path not in allowed directories: {resolved}"
            )

        # Check blocked paths first
        for blocked in self._blocked_paths:
            try:
                resolved.relative_to(blocked)
                self.audit_log("blocked_path_access", {"path": str(resolved)})
                raise SecurityError(f"Access to {blocked} is blocked")
            except ValueError:
                # Not relative to blocked path, continue
                pass

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

        Uses cryptographic signature verification with a trusted public key.
        Plugins should be signed with the corresponding private key.

        Args:
            plugin_path: Path to the plugin file.

        Returns:
            True if the plugin is verified, False otherwise.
        """
        from config.config import SecurityLevel

        if self.config.level == SecurityLevel.LOW:
            logger.warning("Plugin signature verification skipped (low security)")
            return True

        # If no public key is configured, deny in HIGH security, warn in MEDIUM
        if self._public_key is None:
            logger.warning("No public key configured for plugin signature verification")
            if self.config.level == SecurityLevel.HIGH:
                self.audit_log(
                    "plugin_verification_failed",
                    {"path": str(plugin_path), "reason": "no_public_key"},
                )
                return False
            # In MEDIUM security, allow with warning
            logger.warning("Allowing plugin without signature verification (medium security)")
            return True

        # Look for signature file alongside the plugin
        plugin_file = Path(plugin_path)
        signature_file = plugin_file.with_suffix(plugin_file.suffix + ".sig")

        if not signature_file.exists():
            logger.warning("No signature file found for plugin: %s", plugin_path)
            if self.config.level == SecurityLevel.HIGH:
                self.audit_log(
                    "plugin_verification_failed",
                    {"path": str(plugin_path), "reason": "no_signature_file"},
                )
                return False
            return True

        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import padding
            from cryptography.exceptions import InvalidSignature

            # Read the plugin content and signature
            with open(plugin_file, "rb") as f:
                plugin_content = f.read()

            with open(signature_file, "rb") as f:
                signature = f.read()

            # Verify the signature
            self._public_key.verify(
                signature,
                plugin_content,
                padding.PSS(
                    mgf=padding.MGF1(hashes.SHA256()),
                    salt_length=padding.PSS.MAX_LENGTH,
                ),
                hashes.SHA256(),
            )

            logger.info("Plugin signature verified successfully: %s", plugin_path)
            return True

        except InvalidSignature:
            logger.error("Invalid plugin signature: %s", plugin_path)
            self.audit_log(
                "plugin_verification_failed",
                {"path": str(plugin_path), "reason": "invalid_signature"},
            )
            return False

        except Exception as e:
            logger.error("Error verifying plugin signature: %s", e)
            if self.config.level == SecurityLevel.HIGH:
                self.audit_log(
                    "plugin_verification_failed",
                    {"path": str(plugin_path), "reason": str(e)},
                )
                return False
            # In MEDIUM security, allow with warning
            logger.warning("Allowing plugin despite verification error (medium security)")
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
