"""Tests for drawing tools module."""

from __future__ import annotations

import pytest

from core.blueprint.drawing.primitives import (
    Arc,
    BezierCurve,
    Circle,
    DrawStyle,
    Freehand,
    Line,
    Point2D,
    Polyline,
    Rectangle,
)
from core.blueprint.drawing.grid import (
    GridConfig,
    GridSystem,
    GridType,
    SnapMode,
    SnapResult,
)
from core.blueprint.drawing.tools import (
    ArcTool,
    BezierTool,
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


# ---------------------------------------------------------------------------
# Additional tool coverage
# ---------------------------------------------------------------------------

class TestArcToolExtra:
    """Additional tests for ArcTool coverage."""

    def test_arc_tool_creation(self) -> None:
        tool = ArcTool()
        assert tool.name == "Arc"
        assert tool.state == ToolState.IDLE

    def test_three_point_arc(self) -> None:
        tool = ArcTool()
        committed: list = []
        ctx = ToolContext(on_commit=lambda p: committed.append(p))
        tool.set_context(ctx)
        assert tool.on_point(0, 0) is False
        assert tool.on_point(5, 10) is False
        assert tool.on_point(10, 0) is True
        assert len(committed) == 1
        assert isinstance(committed[0], Arc)

    def test_collinear_no_arc(self) -> None:
        tool = ArcTool()
        committed: list = []
        ctx = ToolContext(on_commit=lambda p: committed.append(p))
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_point(5, 0)
        tool.on_point(10, 0)
        assert len(committed) == 0

    def test_arc_preview_line(self) -> None:
        tool = ArcTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_move(5, 5)
        assert isinstance(tool.preview, Line)

    def test_arc_preview_with_two_points(self) -> None:
        tool = ArcTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_point(5, 10)
        tool.on_move(10, 0)
        assert tool.preview is not None

    def test_arc_on_drag(self) -> None:
        tool = ArcTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_drag(5, 5)
        assert tool.preview is not None


class TestBezierToolExtra:
    """Additional tests for BezierTool coverage."""

    def test_bezier_tool_creation(self) -> None:
        tool = BezierTool()
        assert tool.name == "Bezier"
        assert tool.state == ToolState.IDLE

    def test_four_click_bezier(self) -> None:
        tool = BezierTool()
        committed: list = []
        ctx = ToolContext(on_commit=lambda p: committed.append(p))
        tool.set_context(ctx)
        assert tool.on_point(0, 0) is False
        assert tool.on_point(10, 20) is False
        assert tool.on_point(20, 20) is False
        assert tool.on_point(30, 0) is True
        assert len(committed) == 1
        from core.blueprint.drawing.primitives import BezierCurve
        assert isinstance(committed[0], BezierCurve)

    def test_bezier_preview_1_point(self) -> None:
        tool = BezierTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_move(10, 10)
        assert isinstance(tool.preview, Line)

    def test_bezier_preview_2_points(self) -> None:
        tool = BezierTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_point(10, 20)
        tool.on_move(20, 20)
        from core.blueprint.drawing.primitives import BezierCurve
        assert isinstance(tool.preview, BezierCurve)

    def test_bezier_preview_3_points(self) -> None:
        tool = BezierTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_point(10, 20)
        tool.on_point(20, 20)
        tool.on_move(30, 0)
        from core.blueprint.drawing.primitives import BezierCurve
        assert isinstance(tool.preview, BezierCurve)

    def test_bezier_on_drag(self) -> None:
        tool = BezierTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_drag(5, 5)
        assert tool.preview is not None


class TestToolManagerExtra:
    """Additional tests for ToolManager coverage."""

    def test_cycle_forward(self) -> None:
        mgr = ToolManager()
        first = mgr.cycle_tool(forward=True)
        second = mgr.cycle_tool(forward=True)
        assert first is not None
        assert second is not None
        assert first != second

    def test_cycle_backward(self) -> None:
        mgr = ToolManager()
        mgr.set_active("Line")
        name = mgr.cycle_tool(forward=False)
        assert name is not None
        assert name != "Line"

    def test_cycle_no_tools(self) -> None:
        mgr = ToolManager()
        mgr._tools = {}
        assert mgr.cycle_tool() is None

    def test_deactivate(self) -> None:
        mgr = ToolManager()
        mgr.set_active("Line")
        mgr.deactivate()
        assert mgr.active_tool is None
        assert mgr.active_tool_name is None

    def test_set_active_nonexistent(self) -> None:
        mgr = ToolManager()
        assert mgr.set_active("NoSuchTool") is False

    def test_on_point_no_tool(self) -> None:
        mgr = ToolManager()
        assert mgr.on_point(0, 0) is False

    def test_on_move_no_tool(self) -> None:
        mgr = ToolManager()
        mgr.on_move(0, 0)  # should not raise

    def test_on_drag_no_tool(self) -> None:
        mgr = ToolManager()
        mgr.on_drag(0, 0)  # should not raise

    def test_on_complete_no_tool(self) -> None:
        mgr = ToolManager()
        assert mgr.on_complete() is None

    def test_cancel_no_tool(self) -> None:
        mgr = ToolManager()
        mgr.cancel()  # should not raise

    def test_set_context_propagates(self) -> None:
        mgr = ToolManager()
        ctx = ToolContext(constrain_angles=True)
        mgr.set_context(ctx)
        assert mgr.context.constrain_angles is True

    def test_event_forwarding(self) -> None:
        mgr = ToolManager()
        mgr.set_active("Line")
        mgr.on_point(0, 0)
        mgr.on_move(10, 10)
        assert mgr.active_tool.preview is not None

    def test_cancel_active_tool(self) -> None:
        mgr = ToolManager()
        mgr.set_active("Line")
        mgr.on_point(0, 0)
        mgr.cancel()
        assert mgr.active_tool.state == ToolState.IDLE


class TestFreehandToolExtra:
    """Additional tests for FreehandTool coverage."""

    def test_drag_drawing(self) -> None:
        tool = FreehandTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        for i in range(1, 20):
            tool.on_drag(i * 5, i * 3)
        assert tool.preview is not None
        assert isinstance(tool.preview, Freehand)

    def test_min_distance_filter(self) -> None:
        tool = FreehandTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_drag(0.1, 0.1)
        assert len(tool._points) == 1

    def test_on_complete(self) -> None:
        tool = FreehandTool()
        committed: list = []
        ctx = ToolContext(on_commit=lambda p: committed.append(p))
        tool.set_context(ctx)
        tool.on_point(0, 0)
        for i in range(1, 10):
            tool.on_drag(i * 10, i * 5)
        result = tool.on_complete()
        assert isinstance(result, Freehand)

    def test_on_complete_too_few(self) -> None:
        tool = FreehandTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        assert tool.on_complete() is None

    def test_on_move_noop(self) -> None:
        tool = FreehandTool()
        tool.on_move(10, 10)  # should not raise


class TestPolylineToolExtra:
    """Additional tests for PolylineTool coverage."""

    def test_set_closed(self) -> None:
        tool = PolylineTool()
        tool.set_closed(True)
        committed: list = []
        ctx = ToolContext(on_commit=lambda p: committed.append(p))
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_point(10, 0)
        tool.on_point(10, 10)
        result = tool.on_complete()
        assert result.closed is True

    def test_on_complete_too_few(self) -> None:
        tool = PolylineTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        assert tool.on_complete() is None

    def test_undo_last_point(self) -> None:
        tool = PolylineTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_point(10, 10)
        assert tool.undo_last_point() is True
        assert len(tool._points) == 1

    def test_undo_to_empty(self) -> None:
        tool = PolylineTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.undo_last_point()
        assert tool.state == ToolState.IDLE

    def test_undo_empty_false(self) -> None:
        tool = PolylineTool()
        assert tool.undo_last_point() is False

    def test_preview_on_move(self) -> None:
        tool = PolylineTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_move(10, 10)
        assert isinstance(tool.preview, Polyline)

    def test_on_drag(self) -> None:
        tool = PolylineTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_drag(10, 10)
        assert tool.preview is not None


class TestRectangleToolExtra:
    """Additional tests for RectangleTool coverage."""

    def test_square_constraint(self) -> None:
        tool = RectangleTool()
        tool.set_constrain_square(True)
        committed: list = []
        ctx = ToolContext(on_commit=lambda p: committed.append(p))
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_point(30, 20)
        r = committed[0]
        assert r.width == r.height

    def test_preview_square_constraint(self) -> None:
        tool = RectangleTool()
        tool.set_constrain_square(True)
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_move(30, 20)
        assert isinstance(tool.preview, Rectangle)
        assert tool.preview.width == tool.preview.height

    def test_on_drag(self) -> None:
        tool = RectangleTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_drag(10, 20)
        assert tool.preview is not None


class TestCircleToolExtra:
    """Additional tests for CircleTool coverage."""

    def test_zero_radius_no_commit(self) -> None:
        tool = CircleTool()
        committed: list = []
        ctx = ToolContext(on_commit=lambda p: committed.append(p))
        tool.set_context(ctx)
        tool.on_point(5, 5)
        tool.on_point(5, 5)
        assert len(committed) == 0

    def test_preview_on_move(self) -> None:
        tool = CircleTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_move(10, 0)
        assert isinstance(tool.preview, Circle)

    def test_on_drag(self) -> None:
        tool = CircleTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_drag(10, 0)
        assert tool.preview is not None


class TestLineToolExtra:
    """Additional tests for LineTool coverage."""

    def test_on_complete_with_preview(self) -> None:
        tool = LineTool()
        committed: list = []
        ctx = ToolContext(on_commit=lambda p: committed.append(p))
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_move(5, 5)
        result = tool.on_complete()
        assert isinstance(result, Line)

    def test_on_complete_no_preview(self) -> None:
        tool = LineTool()
        assert tool.on_complete() is None

    def test_on_drag(self) -> None:
        tool = LineTool()
        ctx = ToolContext()
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_drag(10, 10)
        assert tool.preview is not None

    def test_style_applied(self) -> None:
        tool = LineTool()
        style = DrawStyle(stroke_color=(255, 0, 0))
        committed: list = []
        ctx = ToolContext(current_style=style, on_commit=lambda p: committed.append(p))
        tool.set_context(ctx)
        tool.on_point(0, 0)
        tool.on_point(10, 10)
        assert committed[0].style == style
