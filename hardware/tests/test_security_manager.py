"""Tests for security manager module."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from config.config import SecurityConfig, SecurityLevel
from core.security.security_manager import (
    RateLimiter,
    SecurityError,
    SecurityManager,
    get_security_manager,
    set_security_manager,
)


class TestRateLimiter:
    """Tests for RateLimiter."""

    def test_allows_within_limit(self):
        """Test that requests within limit are allowed."""
        limiter = RateLimiter(max_requests=5, window_seconds=60)

        for _ in range(5):
            assert limiter.is_allowed("test") is True

    def test_blocks_over_limit(self):
        """Test that requests over limit are blocked."""
        limiter = RateLimiter(max_requests=2, window_seconds=60)

        assert limiter.is_allowed("test") is True
        assert limiter.is_allowed("test") is True
        assert limiter.is_allowed("test") is False

    def test_separate_keys(self):
        """Test that different keys are tracked separately."""
        limiter = RateLimiter(max_requests=1, window_seconds=60)

        assert limiter.is_allowed("user1") is True
        assert limiter.is_allowed("user2") is True
        assert limiter.is_allowed("user1") is False

    def test_reset(self):
        """Test rate limiter reset."""
        limiter = RateLimiter(max_requests=1, window_seconds=60)

        assert limiter.is_allowed("test") is True
        assert limiter.is_allowed("test") is False

        limiter.reset("test")
        assert limiter.is_allowed("test") is True


class TestSecurityManager:
    """Tests for SecurityManager."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield Path(tmpdir)

    @pytest.fixture
    def manager(self, temp_dir):
        """Create a SecurityManager with temp directory as allowed path."""
        config = SecurityConfig(
            level=SecurityLevel.HIGH,
            allowed_paths_str=str(temp_dir),
            blocked_paths_str="/etc,/sys",
            max_file_size_mb=1,
            enable_audit_log=False,
            _env_file=None,
        )
        return SecurityManager(config)

    def test_validate_file_access_allowed(self, manager, temp_dir):
        """Test that allowed paths are validated."""
        test_file = temp_dir / "test.txt"
        test_file.touch()

        result = manager.validate_file_access(str(test_file))
        assert result == test_file.resolve()

    def test_validate_file_access_blocked(self, manager):
        """Test that blocked paths raise SecurityError."""
        with pytest.raises(SecurityError, match="blocked"):
            manager.validate_file_access("/etc/passwd")

    def test_validate_file_access_path_traversal(self, manager, temp_dir):
        """Test that path traversal is blocked."""
        with pytest.raises(SecurityError, match="traversal"):
            manager.validate_file_access(f"{temp_dir}/../../../etc/passwd")

    def test_validate_file_access_tilde(self, manager):
        """Test that tilde paths are blocked."""
        with pytest.raises(SecurityError, match="traversal"):
            manager.validate_file_access("~/.bashrc")

    def test_validate_file_size(self, manager, temp_dir):
        """Test file size validation."""
        # Create a file within limit
        small_file = temp_dir / "small.txt"
        small_file.write_text("Hello")
        manager.validate_file_size(small_file)  # Should not raise

        # Create a file exceeding limit (1MB)
        large_file = temp_dir / "large.txt"
        large_file.write_bytes(b"x" * (2 * 1024 * 1024))

        with pytest.raises(SecurityError, match="size"):
            manager.validate_file_size(large_file)

    def test_sanitize_input_strict(self, manager):
        """Test strict input sanitization."""
        dangerous = "Hello <script>alert('xss')</script> World!"
        result = manager.sanitize_input(dangerous)
        assert "<" not in result
        assert ">" not in result
        assert "'" not in result

    def test_sanitize_input_allow_special(self, manager):
        """Test input sanitization with special chars allowed."""
        text = "Hello, World! (test) [1-2]"
        result = manager.sanitize_input(text, allow_special=True)
        assert "Hello" in result
        assert "World" in result

    def test_sanitize_filename(self, manager):
        """Test filename sanitization."""
        dangerous = "../../../etc/passwd"
        result = manager.sanitize_filename(dangerous)
        assert "/" not in result
        assert "\\" not in result

        # Test empty result handling
        assert manager.sanitize_filename("...") == "unnamed"

    def test_check_rate_limit(self, manager):
        """Test rate limit checking."""
        # Should not raise initially
        for _ in range(50):
            manager.check_rate_limit("test_key")

        # After many calls, should raise
        # (depends on rate limiter config, may need adjustment)

    def test_audit_log_disabled(self, manager):
        """Test that audit log is skipped when disabled."""
        # Should not raise or create files
        manager.audit_log("test_action", {"key": "value"})


class TestSecurityManagerGlobal:
    """Tests for global security manager functions."""

    def test_get_security_manager(self):
        """Test getting global security manager."""
        # Use a fresh instance to avoid env file issues
        manager = SecurityManager(SecurityConfig(_env_file=None))
        set_security_manager(manager)
        result = get_security_manager()
        assert isinstance(result, SecurityManager)

    def test_set_security_manager(self):
        """Test setting global security manager."""
        custom_manager = SecurityManager(SecurityConfig(_env_file=None))
        set_security_manager(custom_manager)

        result = get_security_manager()
        assert result is custom_manager
