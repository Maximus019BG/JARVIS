"""Tests for file access tools."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from config.config import SecurityConfig, SecurityLevel
from core.base_tool import ToolError
from core.security.security_manager import SecurityManager
from tools.read_file_tool import ReadFileTool
from tools.write_file_tool import WriteFileTool


@pytest.fixture
def temp_dir():
    """Create a temporary directory for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def security_manager(temp_dir):
    """Create a security manager with temp dir as allowed path."""
    config = SecurityConfig(
        level=SecurityLevel.MEDIUM,
        allowed_paths_str=str(temp_dir),
        max_file_size_mb=1,
        enable_audit_log=False,
        _env_file=None,
    )
    return SecurityManager(config)


class TestReadFileTool:
    """Tests for ReadFileTool."""

    @pytest.fixture
    def tool(self, security_manager):
        """Create a ReadFileTool instance."""
        return ReadFileTool(security_manager)

    def test_name(self, tool):
        """Test tool name."""
        assert tool.name == "read_file"

    def test_description(self, tool):
        """Test tool description."""
        assert "read" in tool.description.lower()

    def test_schema_parameters(self, tool):
        """Test schema parameters."""
        params = tool.schema_parameters()
        assert params["type"] == "object"
        assert "path" in params["properties"]
        assert "path" in params["required"]

    def test_read_file_success(self, tool, temp_dir):
        """Test successful file reading."""
        test_file = temp_dir / "test.txt"
        test_file.write_text("Hello, World!")

        result = tool.execute(path=str(test_file))
        assert result == "Hello, World!"

    def test_read_file_not_found(self, tool, temp_dir):
        """Test reading non-existent file."""
        with pytest.raises(ToolError, match="not found"):
            tool.execute(path=str(temp_dir / "nonexistent.txt"))

    def test_read_file_directory(self, tool, temp_dir):
        """Test reading a directory fails."""
        with pytest.raises(ToolError, match="Not a file"):
            tool.execute(path=str(temp_dir))

    def test_read_file_with_encoding(self, tool, temp_dir):
        """Test reading with specific encoding."""
        test_file = temp_dir / "test_utf16.txt"
        test_file.write_text("Hello, UTF-16!", encoding="utf-16")

        result = tool.execute(path=str(test_file), encoding="utf-16")
        assert "Hello" in result

    def test_read_file_with_max_lines(self, tool, temp_dir):
        """Test reading with line limit."""
        test_file = temp_dir / "test_lines.txt"
        test_file.write_text("\n".join([f"Line {i}" for i in range(100)]))

        result = tool.execute(path=str(test_file), max_lines=5)
        assert "Line 0" in result
        assert "Line 4" in result
        assert "truncated" in result

    def test_read_file_blocked_path(self, tool):
        """Test reading from blocked path fails."""
        with pytest.raises(ToolError):
            tool.execute(path="/etc/passwd")


class TestWriteFileTool:
    """Tests for WriteFileTool."""

    @pytest.fixture
    def tool(self, security_manager):
        """Create a WriteFileTool instance."""
        return WriteFileTool(security_manager)

    def test_name(self, tool):
        """Test tool name."""
        assert tool.name == "write_file"

    def test_description(self, tool):
        """Test tool description."""
        assert "write" in tool.description.lower()

    def test_schema_parameters(self, tool):
        """Test schema parameters."""
        params = tool.schema_parameters()
        assert params["type"] == "object"
        assert "path" in params["properties"]
        assert "content" in params["properties"]
        assert "path" in params["required"]
        assert "content" in params["required"]

    def test_write_file_success(self, tool, temp_dir):
        """Test successful file writing."""
        test_file = temp_dir / "output.txt"

        result = tool.execute(path=str(test_file), content="Hello, World!")

        assert "Successfully wrote" in result
        assert test_file.read_text() == "Hello, World!"

    def test_write_file_creates_directories(self, tool, temp_dir):
        """Test that parent directories are created."""
        test_file = temp_dir / "subdir" / "nested" / "output.txt"

        tool.execute(path=str(test_file), content="Nested content")

        assert test_file.exists()
        assert test_file.read_text() == "Nested content"

    def test_write_file_with_backup(self, tool, temp_dir):
        """Test backup creation on overwrite."""
        test_file = temp_dir / "backup_test.txt"
        test_file.write_text("Original content")

        result = tool.execute(
            path=str(test_file),
            content="New content",
            create_backup=True,
        )

        assert "backup" in result
        assert test_file.read_text() == "New content"
        # Check backup exists
        backup_files = list(temp_dir.glob("*.backup"))
        assert len(backup_files) == 1
        assert backup_files[0].read_text() == "Original content"

    def test_write_file_append(self, tool, temp_dir):
        """Test appending to file."""
        test_file = temp_dir / "append_test.txt"
        test_file.write_text("First line\n")

        tool.execute(
            path=str(test_file),
            content="Second line\n",
            append=True,
        )

        assert test_file.read_text() == "First line\nSecond line\n"

    def test_write_file_blocked_path(self, tool):
        """Test writing to blocked path fails."""
        with pytest.raises(ToolError):
            tool.execute(path="/etc/test.txt", content="Bad content")
