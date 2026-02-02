"""Tests for gesture control tool."""

import pytest

from core.base_tool import ToolResult
from core.vision.gesture_recognizer import GestureType
from tools.gesture_control_tool import GestureControlTool


class TestGestureControlTool:
    """Tests for GestureControlTool class."""

    def test_tool_name(self) -> None:
        """Test tool has correct name."""
        tool = GestureControlTool()
        assert tool.name == "gesture_control"

    def test_tool_description(self) -> None:
        """Test tool has description."""
        tool = GestureControlTool()
        assert len(tool.description) > 0
        assert "gesture" in tool.description.lower()

    def test_enable_action(self) -> None:
        """Test enable action enables gesture control."""
        tool = GestureControlTool()

        result = tool.execute(action="enable")

        assert result.ok
        assert "enabled" in result.content.lower()
        assert tool.is_enabled

    def test_disable_action(self) -> None:
        """Test disable action disables gesture control."""
        tool = GestureControlTool()
        tool.execute(action="enable")

        result = tool.execute(action="disable")

        assert result.ok
        assert "disabled" in result.content.lower()
        assert not tool.is_enabled

    def test_status_action(self) -> None:
        """Test status action returns current state."""
        tool = GestureControlTool()

        result = tool.execute(action="status")

        assert result.ok
        assert "gesture control" in result.content.lower()

    def test_map_gesture_valid(self) -> None:
        """Test mapping a valid gesture to a command."""
        tool = GestureControlTool()

        result = tool.execute(
            action="map",
            gesture="thumbs_up",
            command="approve",
        )

        assert result.ok
        assert "mapped" in result.content.lower()
        assert tool.get_command_for_gesture(GestureType.THUMBS_UP) == "approve"

    def test_map_gesture_invalid(self) -> None:
        """Test mapping an invalid gesture name fails."""
        tool = GestureControlTool()

        result = tool.execute(
            action="map",
            gesture="invalid_gesture",
            command="test",
        )

        assert not result.ok
        assert result.error_type == "validation_error"

    def test_map_missing_params(self) -> None:
        """Test map action requires both gesture and command."""
        tool = GestureControlTool()

        result = tool.execute(action="map", gesture="thumbs_up")

        assert not result.ok
        assert result.error_type == "validation_error"

    def test_unmap_gesture(self) -> None:
        """Test unmapping a gesture."""
        tool = GestureControlTool()
        tool.execute(action="map", gesture="wave", command="hello")

        result = tool.execute(action="unmap", gesture="wave")

        assert result.ok
        assert tool.get_command_for_gesture(GestureType.WAVE) is None

    def test_unmap_nonexistent(self) -> None:
        """Test unmapping non-existent gesture fails."""
        tool = GestureControlTool()

        result = tool.execute(action="unmap", gesture="wave")

        assert not result.ok
        assert result.error_type == "not_found"

    def test_list_mappings(self) -> None:
        """Test list action shows all mappings."""
        tool = GestureControlTool()

        result = tool.execute(action="list")

        assert result.ok
        # Should have default mappings
        assert "thumbs_up" in result.content

    def test_list_shows_available_gestures(self) -> None:
        """Test list action shows available gesture types."""
        tool = GestureControlTool()

        result = tool.execute(action="list")

        assert result.ok
        assert "available gestures" in result.content.lower()

    def test_unknown_action(self) -> None:
        """Test unknown action returns error."""
        tool = GestureControlTool()

        result = tool.execute(action="unknown_action")

        assert not result.ok
        assert result.error_type == "validation_error"

    def test_get_command_for_gesture(self) -> None:
        """Test get_command_for_gesture returns correct mapping."""
        tool = GestureControlTool()

        # Default mapping
        cmd = tool.get_command_for_gesture(GestureType.THUMBS_UP)
        assert cmd == "confirm"

        # Non-mapped gesture
        cmd = tool.get_command_for_gesture(GestureType.NONE)
        assert cmd is None

    def test_schema_parameters(self) -> None:
        """Test schema_parameters returns valid schema."""
        tool = GestureControlTool()

        schema = tool.schema_parameters()

        assert schema["type"] == "object"
        assert "action" in schema["properties"]
        assert "action" in schema["required"]
