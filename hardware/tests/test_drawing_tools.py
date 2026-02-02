"""Tests for drawing tools module."""

from __future__ import annotations

import pytest

from core.blueprint.drawing.primitives import (
    Circle,
    Line,
    Point2D,
    Rectangle,
    Polyline,
    DrawStyle,
)
from core.blueprint.drawing.grid import (
    GridConfig,
    GridSystem,
    GridType,
    SnapMode,
    SnapResult,
)
from core.blueprint.drawing.tools import (
    CircleTool,
    DrawingTool,
    FreehandTool,
    LineTool,
    PolylineTool,
    RectangleTool,
    ToolContext,
    ToolManager,
    ToolState,
)
from core.blueprint.drawing.canvas import DrawingCanvas, Layer


class TestGridSystem:
    """Tests for GridSystem."""

    def test_grid_creation(self) -> None:
        """Test grid creation with defaults."""
        grid = GridSystem()
        assert grid.config.major_spacing == 100.0
        assert grid.config.grid_type == GridType.LINES

    def test_grid_custom_config(self) -> None:
        """Test grid with custom config."""
        config = GridConfig(
            major_spacing=25,
            grid_type=GridType.ISOMETRIC,
            show_major=False,
        )
        grid = GridSystem(config=config)

        assert grid.config.major_spacing == 25
        assert grid.config.grid_type == GridType.ISOMETRIC
        assert grid.config.show_major is False

    def test_snap_to_grid(self) -> None:
        """Test snapping to grid."""
        config = GridConfig(major_spacing=10, minor_divisions=1)
        grid = GridSystem(config=config)
        grid.enable_snap(SnapMode.GRID)

        result = grid.snap(12, 18)
        assert result.snapped is True
        assert result.point[0] == pytest.approx(10, abs=1)
        assert result.point[1] == pytest.approx(20, abs=1)

    def test_snap_disabled(self) -> None:
        """Test snap when disabled."""
        grid = GridSystem()
        grid.disable_snap(SnapMode.GRID)

        result = grid.snap(12, 18)
        # Should return unsnapped point
        assert result.point == (12, 18)


class TestToolContext:
    """Tests for ToolContext."""

    def test_context_creation(self) -> None:
        """Test context creation."""
        context = ToolContext()
        assert context.grid is None
        assert context.constrain_angles is False

    def test_context_with_grid(self) -> None:
        """Test context with grid."""
        grid = GridSystem()
        context = ToolContext(grid=grid)
        assert context.grid is grid


class TestLineTool:
    """Tests for LineTool."""

    def test_line_tool_creation(self) -> None:
        """Test line tool creation."""
        tool = LineTool()
        assert tool.name == "Line"
        assert tool.state == ToolState.IDLE

    def test_line_tool_draw(self) -> None:
        """Test drawing a line."""
        tool = LineTool()
        committed: list = []

        context = ToolContext(
            on_commit=lambda p: committed.append(p),
        )
        tool.set_context(context)

        # First point
        result1 = tool.on_point(0, 0)
        assert result1 is False
        assert tool.state == ToolState.ACTIVE

        # Second point
        result2 = tool.on_point(100, 100)
        assert result2 is True
        assert tool.state == ToolState.IDLE

        # Check committed line
        assert len(committed) == 1
        assert isinstance(committed[0], Line)

    def test_line_tool_preview(self) -> None:
        """Test line preview."""
        tool = LineTool()
        previews: list = []

        context = ToolContext(
            on_preview=lambda p: previews.append(p),
        )
        tool.set_context(context)

        # Start line
        tool.on_point(0, 0)

        # Move to show preview
        tool.on_move(50, 50)

        assert tool.preview is not None
        assert isinstance(tool.preview, Line)

    def test_line_tool_reset(self) -> None:
        """Test line tool reset."""
        tool = LineTool()
        tool.on_point(0, 0)
        assert tool.state == ToolState.ACTIVE

        tool.reset()
        assert tool.state == ToolState.IDLE


class TestRectangleTool:
    """Tests for RectangleTool."""

    def test_rectangle_tool_creation(self) -> None:
        """Test rectangle tool creation."""
        tool = RectangleTool()
        assert tool.name == "Rectangle"
        assert tool.state == ToolState.IDLE

    def test_rectangle_tool_draw(self) -> None:
        """Test drawing a rectangle."""
        tool = RectangleTool()
        committed: list = []

        context = ToolContext(
            on_commit=lambda p: committed.append(p),
        )
        tool.set_context(context)

        # First corner
        result1 = tool.on_point(10, 10)
        assert result1 is False
        assert tool.state == ToolState.ACTIVE

        # Opposite corner
        result2 = tool.on_point(110, 60)
        assert result2 is True

        # Check committed rectangle
        assert len(committed) == 1
        assert isinstance(committed[0], Rectangle)


class TestCircleTool:
    """Tests for CircleTool."""

    def test_circle_tool_creation(self) -> None:
        """Test circle tool creation."""
        tool = CircleTool()
        assert tool.name == "Circle"
        assert tool.state == ToolState.IDLE

    def test_circle_tool_draw(self) -> None:
        """Test drawing a circle."""
        tool = CircleTool()
        committed: list = []

        context = ToolContext(
            on_commit=lambda p: committed.append(p),
        )
        tool.set_context(context)

        # Center point
        result1 = tool.on_point(50, 50)
        assert result1 is False

        # Edge point (defines radius)
        result2 = tool.on_point(100, 50)
        assert result2 is True

        # Check committed circle
        assert len(committed) == 1
        assert isinstance(committed[0], Circle)
        circle = committed[0]
        assert circle.radius == pytest.approx(50)


class TestPolylineTool:
    """Tests for PolylineTool."""

    def test_polyline_tool_creation(self) -> None:
        """Test polyline tool creation."""
        tool = PolylineTool()
        assert tool.name == "Polyline"
        assert tool.state == ToolState.IDLE

    def test_polyline_tool_draw_multiple_points(self) -> None:
        """Test drawing a polyline with multiple points."""
        tool = PolylineTool()
        committed: list = []

        context = ToolContext(
            on_commit=lambda p: committed.append(p),
        )
        tool.set_context(context)

        # Add points
        tool.on_point(0, 0)
        tool.on_point(50, 50)
        tool.on_point(100, 0)

        # Complete the polyline
        result = tool.on_complete()

        assert result is not None
        assert isinstance(result, Polyline)
        assert len(result.points) == 3


class TestFreehandTool:
    """Tests for FreehandTool."""

    def test_freehand_tool_creation(self) -> None:
        """Test freehand tool creation."""
        tool = FreehandTool()
        assert tool.name == "Freehand"
        assert tool.state == ToolState.IDLE


class TestToolManager:
    """Tests for ToolManager."""

    def test_manager_creation(self) -> None:
        """Test tool manager creation."""
        manager = ToolManager()
        assert manager.active_tool is None

    def test_manager_set_active_tool(self) -> None:
        """Test selecting a tool."""
        manager = ToolManager()

        manager.set_active("Line")
        assert manager.active_tool is not None
        assert isinstance(manager.active_tool, LineTool)

    def test_manager_select_rectangle(self) -> None:
        """Test selecting rectangle tool."""
        manager = ToolManager()

        manager.set_active("Rectangle")
        assert isinstance(manager.active_tool, RectangleTool)

    def test_manager_get_available_tools(self) -> None:
        """Test getting available tools."""
        manager = ToolManager()
        tools = manager.tool_names

        assert "Line" in tools
        assert "Rectangle" in tools
        assert "Circle" in tools


class TestLayer:
    """Tests for Layer."""

    def test_layer_creation(self) -> None:
        """Test layer creation."""
        layer = Layer(name="Test Layer")
        assert layer.name == "Test Layer"
        assert layer.visible is True
        assert layer.locked is False

    def test_layer_add_primitive(self) -> None:
        """Test adding primitive to layer."""
        layer = Layer(name="Test")
        line = Line(start=Point2D(0, 0), end=Point2D(100, 100))

        layer.add(line)
        assert len(layer.primitives) == 1
        assert layer.primitives[0] is line

    def test_layer_remove_primitive(self) -> None:
        """Test removing primitive from layer."""
        layer = Layer(name="Test")
        line = Line(start=Point2D(0, 0), end=Point2D(100, 100))

        layer.add(line)
        layer.remove(line.id)
        assert len(layer.primitives) == 0


class TestDrawingCanvas:
    """Tests for DrawingCanvas."""

    def test_canvas_creation(self) -> None:
        """Test canvas creation."""
        canvas = DrawingCanvas()
        assert len(canvas.layers) >= 1  # Has default layer

    def test_canvas_add_layer(self) -> None:
        """Test adding layer to canvas."""
        canvas = DrawingCanvas()
        initial_count = len(canvas.layers)

        layer = canvas.add_layer("New Layer")
        assert len(canvas.layers) == initial_count + 1
        assert layer.name == "New Layer"

    def test_canvas_active_layer(self) -> None:
        """Test active layer."""
        canvas = DrawingCanvas()
        assert canvas.active_layer is not None

    def test_canvas_add_primitive(self) -> None:
        """Test adding primitive to canvas."""
        canvas = DrawingCanvas()
        line = Line(start=Point2D(0, 0), end=Point2D(100, 100))

        canvas.add_primitive(line)
        assert line in canvas.active_layer.primitives
