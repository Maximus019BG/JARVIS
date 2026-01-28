"""Validation utilities for common data types."""

import re


def is_valid_email(email: str) -> bool:
    """Validate email address format.

    Uses a more robust regex pattern that:
    - Allows common email characters (letters, numbers, dots, underscores, hyphens, plus)
    - Requires @ symbol
    - Requires a domain with at least one dot
    - Allows for subdomains
    - Validates TLD (top-level domain) is at least 2 characters

    Args:
        email: Email address to validate.

    Returns:
        True if email format is valid, False otherwise.

    Examples:
        >>> is_valid_email("user@example.com")
        True
        >>> is_valid_email("user.name+tag@sub.domain.co.uk")
        True
        >>> is_valid_email("invalid-email")
        False
        >>> is_valid_email("user@")
        False
    """
    # RFC 5322 compliant email regex (simplified for practical use)
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    return bool(re.match(pattern, email))
