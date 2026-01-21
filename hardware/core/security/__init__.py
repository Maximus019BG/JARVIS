"""Security module for file access control and audit logging."""

from core.security.security_manager import (
    SecurityError,
    SecurityManager,
    get_security_manager,
    set_security_manager,
)

__all__ = [
    "SecurityError",
    "SecurityManager",
    "get_security_manager",
    "set_security_manager",
]
