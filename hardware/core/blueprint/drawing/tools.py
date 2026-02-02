"""Drawing tools for blueprint creation.

Provides interactive drawing tools for creating primitives.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Callable

from core.blueprint.drawing.primitives import (
    Primitive,
    Line,
    Arc,
    BezierCurve,
    Rectangle,
    Circle,
    Polyline,
    Freehand,
    Point2D,
    DrawStyle,
)
from core.blueprint.drawing.grid import GridSystem, SnapResult

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine


class ToolState(str, Enum):
    """State of a drawing tool."""

    IDLE = "idle"  # Ready to start
    ACTIVE = "active"  # Drawing in progress
    PREVIEW = "preview"  # Showing preview
    COMPLETE = "complete"  # Finished, ready to commit


@dataclass
class ToolContext:
    """Context passed to drawing tools."""

    grid: GridSystem | None = None
    current_style: DrawStyle | None = None
    constrain_angles: bool = False
    constraint_angles: list[float] = field(default_factory=lambda: [0, 45, 90, 135, 180, 225, 270, 315])
    on_preview: Callable[[Primitive | None], None] | None = None
    on_commit: Callable[[Primitive], None] | None = None


class DrawingTool(ABC):
    """Base class for drawing tools.

    Tools manage the interactive creation of primitives through
    a series of input events (points, clicks, drags).
    """

    def __init__(self) -> None:
        self._state = ToolState.IDLE
        self._context: ToolContext | None = None
        self._preview: Primitive | None = None

    @property
    @abstractmethod
    def name(self) -> str:
        """Tool name."""

    @property
    @abstractmethod
    def description(self) -> str:
        """Tool description."""

    @property
    def state(self) -> ToolState:
        """Current tool state."""
        return self._state

    @property
    def preview(self) -> Primitive | None:
        """Current preview primitive."""
        return self._preview

    def set_context(self, context: ToolContext) -> None:
        """Set the tool context."""
        self._context = context

    def _snap_point(self, x: float, y: float) -> tuple[float, float]:
        """Apply snapping if grid is available."""
        if self._context and self._context.grid:
            result = self._context.grid.snap(x, y)
            if result.snapped:
                return result.point
        return (x, y)

    def _emit_preview(self) -> None:
        """Emit preview to context handler."""
        if self._context and self._context.on_preview:
            self._context.on_preview(self._preview)

    def _commit(self, primitive: Primitive) -> None:
        """Commit a completed primitive."""
        if self._context:
            if self._context.current_style:
                primitive.style = self._context.current_style
            if self._context.on_commit:
                self._context.on_commit(primitive)

    @abstractmethod
    def on_point(self, x: float, y: float) -> bool:
        """Handle a point input (click/tap).

        Args:
            x: X coordinate.
            y: Y coordinate.

        Returns:
            True if tool completed and primitive is ready.
        """

    @abstractmethod
    def on_move(self, x: float, y: float) -> None:
        """Handle pointer movement for preview.

        Args:
            x: X coordinate.
            y: Y coordinate.
        """

    @abstractmethod
    def on_drag(self, x: float, y: float) -> None:
        """Handle drag movement.

        Args:
            x: X coordinate.
            y: Y coordinate.
        """

    def on_complete(self) -> Primitive | None:
        """Finish drawing and get the result.

        Returns:
            Completed primitive or None if cancelled.
        """
        return None

    def cancel(self) -> None:
        """Cancel current drawing operation."""
        self._state = ToolState.IDLE
        self._preview = None
        self._emit_preview()

    def reset(self) -> None:
        """Reset tool to initial state."""
        self._state = ToolState.IDLE
        self._preview = None


class LineTool(DrawingTool):
    """Straight line drawing tool.

    Click once to set start point, click again or drag to set end.
    """

    def __init__(self) -> None:
        super().__init__()
        self._start: Point2D | None = None

    @property
    def name(self) -> str:
        return "Line"

    @property
    def description(self) -> str:
        return "Draw a straight line between two points"

    def on_point(self, x: float, y: float) -> bool:
        x, y = self._snap_point(x, y)

        if self._state == ToolState.IDLE:
            # First point - start line
            self._start = Point2D(x, y)
            self._state = ToolState.ACTIVE
            return False

        elif self._state == ToolState.ACTIVE and self._start:
            # Second point - complete line
            end = Point2D(x, y)

            # Apply angle constraint if enabled
            if self._context and self._context.constrain_angles:
                ex, ey = self._context.grid.constrain_angle(
                    self._start.x, self._start.y, x, y,
                    self._context.constraint_angles,
                ) if self._context.grid else (x, y)
                end = Point2D(ex, ey)

            line = Line(start=self._start, end=end)
            self._commit(line)
            self.reset()
            return True

        return False

    def on_move(self, x: float, y: float) -> None:
        if self._state == ToolState.ACTIVE and self._start:
            x, y = self._snap_point(x, y)

            # Apply angle constraint if enabled
            if self._context and self._context.constrain_angles and self._context.grid:
                x, y = self._context.grid.constrain_angle(
                    self._start.x, self._start.y, x, y,
                    self._context.constraint_angles,
                )

            self._preview = Line(start=self._start, end=Point2D(x, y))
            self._emit_preview()

    def on_drag(self, x: float, y: float) -> None:
        self.on_move(x, y)

    def on_complete(self) -> Primitive | None:
        if self._preview:
            result = self._preview
            self._commit(result)
            self.reset()
            return result
        return None

    def reset(self) -> None:
        super().reset()
        self._start = None


class RectangleTool(DrawingTool):
    """Rectangle drawing tool.

    Click once to set corner, click again or drag to set opposite corner.
    """

    def __init__(self) -> None:
        super().__init__()
        self._origin: Point2D | None = None
        self._constrain_square: bool = False

    @property
    def name(self) -> str:
        return "Rectangle"

    @property
    def description(self) -> str:
        return "Draw a rectangle by clicking two corners"

    def set_constrain_square(self, constrain: bool) -> None:
        """Enable/disable square constraint."""
        self._constrain_square = constrain

    def on_point(self, x: float, y: float) -> bool:
        x, y = self._snap_point(x, y)

        if self._state == ToolState.IDLE:
            self._origin = Point2D(x, y)
            self._state = ToolState.ACTIVE
            return False

        elif self._state == ToolState.ACTIVE and self._origin:
            width = x - self._origin.x
            height = y - self._origin.y

            if self._constrain_square:
                size = max(abs(width), abs(height))
                width = size if width >= 0 else -size
                height = size if height >= 0 else -size

            # Normalize to positive dimensions
            origin = Point2D(
                min(self._origin.x, self._origin.x + width),
                min(self._origin.y, self._origin.y + height),
            )

            rect = Rectangle(
                origin=origin,
                width=abs(width),
                height=abs(height),
            )
            self._commit(rect)
            self.reset()
            return True

        return False

    def on_move(self, x: float, y: float) -> None:
        if self._state == ToolState.ACTIVE and self._origin:
            x, y = self._snap_point(x, y)
            width = x - self._origin.x
            height = y - self._origin.y

            if self._constrain_square:
                size = max(abs(width), abs(height))
                width = size if width >= 0 else -size
                height = size if height >= 0 else -size

            origin = Point2D(
                min(self._origin.x, self._origin.x + width),
                min(self._origin.y, self._origin.y + height),
            )

            self._preview = Rectangle(
                origin=origin,
                width=abs(width),
                height=abs(height),
            )
            self._emit_preview()

    def on_drag(self, x: float, y: float) -> None:
        self.on_move(x, y)

    def reset(self) -> None:
        super().reset()
        self._origin = None


class CircleTool(DrawingTool):
    """Circle drawing tool (center + radius).

    Click to set center, move/click to set radius.
    """

    def __init__(self) -> None:
        super().__init__()
        self._center: Point2D | None = None

    @property
    def name(self) -> str:
        return "Circle"

    @property
    def description(self) -> str:
        return "Draw a circle by clicking center then setting radius"

    def on_point(self, x: float, y: float) -> bool:
        x, y = self._snap_point(x, y)

        if self._state == ToolState.IDLE:
            self._center = Point2D(x, y)
            self._state = ToolState.ACTIVE
            return False

        elif self._state == ToolState.ACTIVE and self._center:
            radius = self._center.distance_to(Point2D(x, y))
            if radius > 0:
                circle = Circle(center=self._center, radius=radius)
                self._commit(circle)
            self.reset()
            return True

        return False

    def on_move(self, x: float, y: float) -> None:
        if self._state == ToolState.ACTIVE and self._center:
            x, y = self._snap_point(x, y)
            radius = self._center.distance_to(Point2D(x, y))
            if radius > 0:
                self._preview = Circle(center=self._center, radius=radius)
                self._emit_preview()

    def on_drag(self, x: float, y: float) -> None:
        self.on_move(x, y)

    def reset(self) -> None:
        super().reset()
        self._center = None


class ArcTool(DrawingTool):
    """Arc drawing tool (3-point arc).

    Click three points: start, midpoint on arc, end.
    """

    def __init__(self) -> None:
        super().__init__()
        self._points: list[Point2D] = []

    @property
    def name(self) -> str:
        return "Arc"

    @property
    def description(self) -> str:
        return "Draw an arc through three points"

    def on_point(self, x: float, y: float) -> bool:
        x, y = self._snap_point(x, y)
        point = Point2D(x, y)

        self._points.append(point)

        if len(self._points) == 1:
            self._state = ToolState.ACTIVE
            return False

        elif len(self._points) == 3:
            arc = self._create_arc_from_points(*self._points)
            if arc:
                self._commit(arc)
            self.reset()
            return True

        return False

    def on_move(self, x: float, y: float) -> None:
        if self._state == ToolState.ACTIVE and self._points:
            x, y = self._snap_point(x, y)

            if len(self._points) == 1:
                # Show line from start to cursor
                self._preview = Line(
                    start=self._points[0],
                    end=Point2D(x, y),
                )
            elif len(self._points) == 2:
                # Show arc through all three points
                arc = self._create_arc_from_points(
                    self._points[0], self._points[1], Point2D(x, y)
                )
                self._preview = arc

            self._emit_preview()

    def on_drag(self, x: float, y: float) -> None:
        self.on_move(x, y)

    def _create_arc_from_points(
        self, p1: Point2D, p2: Point2D, p3: Point2D
    ) -> Arc | None:
        """Create arc from three points using circumcircle."""
        import math

        ax, ay = p1.x, p1.y
        bx, by = p2.x, p2.y
        cx, cy = p3.x, p3.y

        d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
        if abs(d) < 1e-10:
            return None  # Points are collinear

        ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
        uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d

        center = Point2D(ux, uy)
        radius = center.distance_to(p1)

        start_angle = math.atan2(p1.y - center.y, p1.x - center.x)
        end_angle = math.atan2(p3.y - center.y, p3.x - center.x)

        return Arc(
            center=center,
            radius=radius,
            start_angle=start_angle,
            end_angle=end_angle,
        )

    def reset(self) -> None:
        super().reset()
        self._points = []


class PolylineTool(DrawingTool):
    """Multi-segment line tool.

    Click to add points, double-click or call complete() to finish.
    """

    def __init__(self) -> None:
        super().__init__()
        self._points: list[Point2D] = []
        self._closed = False

    @property
    def name(self) -> str:
        return "Polyline"

    @property
    def description(self) -> str:
        return "Draw connected line segments"

    def set_closed(self, closed: bool) -> None:
        """Set whether to close the polyline."""
        self._closed = closed

    def on_point(self, x: float, y: float) -> bool:
        x, y = self._snap_point(x, y)
        self._points.append(Point2D(x, y))
        self._state = ToolState.ACTIVE
        return False  # Never completes on single click

    def on_move(self, x: float, y: float) -> None:
        if self._state == ToolState.ACTIVE and self._points:
            x, y = self._snap_point(x, y)
            preview_points = self._points + [Point2D(x, y)]
            self._preview = Polyline(points=preview_points, closed=self._closed)
            self._emit_preview()

    def on_drag(self, x: float, y: float) -> None:
        self.on_move(x, y)

    def on_complete(self) -> Primitive | None:
        if len(self._points) >= 2:
            polyline = Polyline(points=self._points.copy(), closed=self._closed)
            self._commit(polyline)
            self.reset()
            return polyline
        return None

    def undo_last_point(self) -> bool:
        """Remove the last added point."""
        if self._points:
            self._points.pop()
            if not self._points:
                self._state = ToolState.IDLE
            return True
        return False

    def reset(self) -> None:
        super().reset()
        self._points = []


class FreehandTool(DrawingTool):
    """Freehand drawing tool.

    Draw by dragging - collects points during drag.
    """

    def __init__(self) -> None:
        super().__init__()
        self._points: list[Point2D] = []
        self._min_distance: float = 3.0  # Min distance between points

    @property
    def name(self) -> str:
        return "Freehand"

    @property
    def description(self) -> str:
        return "Draw freehand by dragging"

    def on_point(self, x: float, y: float) -> bool:
        # Start a new freehand path
        self._points = [Point2D(x, y)]
        self._state = ToolState.ACTIVE
        return False

    def on_move(self, x: float, y: float) -> None:
        # Freehand only draws during drag
        pass

    def on_drag(self, x: float, y: float) -> None:
        if self._state == ToolState.ACTIVE:
            point = Point2D(x, y)

            # Only add if far enough from last point
            if self._points:
                if point.distance_to(self._points[-1]) >= self._min_distance:
                    self._points.append(point)
            else:
                self._points.append(point)

            if len(self._points) >= 2:
                freehand = Freehand(points=self._points.copy())
                self._preview = freehand
                self._emit_preview()

    def on_complete(self) -> Primitive | None:
        if len(self._points) >= 2:
            freehand = Freehand(points=self._points.copy())
            freehand.smooth()  # Apply smoothing
            freehand.simplify()  # Reduce points
            self._commit(freehand)
            self.reset()
            return freehand
        return None

    def reset(self) -> None:
        super().reset()
        self._points = []


class BezierTool(DrawingTool):
    """Bezier curve tool.

    Click for each control point (4 points total).
    """

    def __init__(self) -> None:
        super().__init__()
        self._points: list[Point2D] = []

    @property
    def name(self) -> str:
        return "Bezier"

    @property
    def description(self) -> str:
        return "Draw a cubic Bezier curve with 4 control points"

    def on_point(self, x: float, y: float) -> bool:
        x, y = self._snap_point(x, y)
        self._points.append(Point2D(x, y))

        if len(self._points) == 1:
            self._state = ToolState.ACTIVE
            return False

        elif len(self._points) == 4:
            bezier = BezierCurve(
                p0=self._points[0],
                p1=self._points[1],
                p2=self._points[2],
                p3=self._points[3],
            )
            self._commit(bezier)
            self.reset()
            return True

        return False

    def on_move(self, x: float, y: float) -> None:
        if self._state == ToolState.ACTIVE and self._points:
            x, y = self._snap_point(x, y)
            current = Point2D(x, y)

            n = len(self._points)
            if n == 1:
                self._preview = Line(start=self._points[0], end=current)
            elif n == 2:
                # Show quadratic-ish preview
                self._preview = BezierCurve(
                    p0=self._points[0],
                    p1=self._points[1],
                    p2=current,
                    p3=current,
                )
            elif n == 3:
                self._preview = BezierCurve(
                    p0=self._points[0],
                    p1=self._points[1],
                    p2=self._points[2],
                    p3=current,
                )

            self._emit_preview()

    def on_drag(self, x: float, y: float) -> None:
        self.on_move(x, y)

    def reset(self) -> None:
        super().reset()
        self._points = []


class ToolManager:
    """Manages available drawing tools.

    Provides tool switching and routing of input events.

    Usage:
        manager = ToolManager()
        manager.set_active("Line")
        manager.on_point(100, 100)
        manager.on_move(200, 200)
        manager.on_point(200, 200)
    """

    def __init__(self) -> None:
        self._tools: dict[str, DrawingTool] = {}
        self._active_tool: DrawingTool | None = None
        self._context = ToolContext()

        # Register default tools
        self._register_default_tools()

    def _register_default_tools(self) -> None:
        """Register built-in tools."""
        tools = [
            LineTool(),
            RectangleTool(),
            CircleTool(),
            ArcTool(),
            PolylineTool(),
            FreehandTool(),
            BezierTool(),
        ]
        for tool in tools:
            self.register(tool)

    def register(self, tool: DrawingTool) -> None:
        """Register a drawing tool."""
        self._tools[tool.name] = tool
        tool.set_context(self._context)

    @property
    def tool_names(self) -> list[str]:
        """Get list of available tool names."""
        return list(self._tools.keys())

    @property
    def active_tool(self) -> DrawingTool | None:
        """Get currently active tool."""
        return self._active_tool

    @property
    def active_tool_name(self) -> str | None:
        """Get name of active tool."""
        return self._active_tool.name if self._active_tool else None

    @property
    def context(self) -> ToolContext:
        """Get tool context."""
        return self._context

    def set_context(self, context: ToolContext) -> None:
        """Set context for all tools."""
        self._context = context
        for tool in self._tools.values():
            tool.set_context(context)

    def set_active(self, tool_name: str) -> bool:
        """Activate a tool by name.

        Args:
            tool_name: Name of tool to activate.

        Returns:
            True if tool was activated.
        """
        if tool_name in self._tools:
            if self._active_tool:
                self._active_tool.cancel()
            self._active_tool = self._tools[tool_name]
            self._active_tool.reset()
            return True
        return False

    def cycle_tool(self, forward: bool = True) -> str | None:
        """Cycle to next/previous tool.

        Args:
            forward: If True, cycle forward. If False, cycle backward.

        Returns:
            Name of new active tool.
        """
        names = self.tool_names
        if not names:
            return None

        if self._active_tool is None:
            idx = 0
        else:
            try:
                idx = names.index(self._active_tool.name)
                idx = (idx + (1 if forward else -1)) % len(names)
            except ValueError:
                idx = 0

        self.set_active(names[idx])
        return names[idx]

    def deactivate(self) -> None:
        """Deactivate the current tool."""
        if self._active_tool:
            self._active_tool.cancel()
            self._active_tool = None

    def on_point(self, x: float, y: float) -> bool:
        """Forward point event to active tool."""
        if self._active_tool:
            return self._active_tool.on_point(x, y)
        return False

    def on_move(self, x: float, y: float) -> None:
        """Forward move event to active tool."""
        if self._active_tool:
            self._active_tool.on_move(x, y)

    def on_drag(self, x: float, y: float) -> None:
        """Forward drag event to active tool."""
        if self._active_tool:
            self._active_tool.on_drag(x, y)

    def on_complete(self) -> Primitive | None:
        """Complete current drawing operation."""
        if self._active_tool:
            return self._active_tool.on_complete()
        return None

    def cancel(self) -> None:
        """Cancel current drawing operation."""
        if self._active_tool:
            self._active_tool.cancel()
