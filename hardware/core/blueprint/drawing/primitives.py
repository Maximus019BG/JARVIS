"""Geometric primitives for blueprint drawing.

Provides basic shapes and curves for drawing operations.
"""

from __future__ import annotations

import math
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Iterator


class PrimitiveType(str, Enum):
    """Types of drawable primitives."""

    LINE = "line"
    ARC = "arc"
    BEZIER = "bezier"
    RECTANGLE = "rectangle"
    CIRCLE = "circle"
    ELLIPSE = "ellipse"
    POLYLINE = "polyline"
    POLYGON = "polygon"
    FREEHAND = "freehand"
    TEXT = "text"
    DIMENSION = "dimension"


@dataclass
class Point2D:
    """2D point with utility methods."""

    x: float = 0.0
    y: float = 0.0

    def distance_to(self, other: Point2D) -> float:
        """Calculate distance to another point."""
        dx = other.x - self.x
        dy = other.y - self.y
        return math.sqrt(dx * dx + dy * dy)

    def angle_to(self, other: Point2D) -> float:
        """Calculate angle to another point in radians."""
        return math.atan2(other.y - self.y, other.x - self.x)

    def midpoint(self, other: Point2D) -> Point2D:
        """Calculate midpoint between this and another point."""
        return Point2D((self.x + other.x) / 2, (self.y + other.y) / 2)

    def translate(self, dx: float, dy: float) -> Point2D:
        """Return translated point."""
        return Point2D(self.x + dx, self.y + dy)

    def rotate(self, angle: float, center: Point2D | None = None) -> Point2D:
        """Rotate around a center point (default: origin)."""
        cx, cy = (center.x, center.y) if center else (0, 0)
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        dx, dy = self.x - cx, self.y - cy
        return Point2D(
            cx + dx * cos_a - dy * sin_a,
            cy + dx * sin_a + dy * cos_a,
        )

    def scale(self, factor: float, center: Point2D | None = None) -> Point2D:
        """Scale from a center point (default: origin)."""
        cx, cy = (center.x, center.y) if center else (0, 0)
        return Point2D(
            cx + (self.x - cx) * factor,
            cy + (self.y - cy) * factor,
        )

    def to_tuple(self) -> tuple[float, float]:
        """Convert to tuple."""
        return (self.x, self.y)

    def to_int_tuple(self) -> tuple[int, int]:
        """Convert to integer tuple (for pixel coordinates)."""
        return (int(round(self.x)), int(round(self.y)))

    @classmethod
    def from_tuple(cls, t: tuple[float, float]) -> Point2D:
        """Create from tuple."""
        return cls(t[0], t[1])

    def __add__(self, other: Point2D) -> Point2D:
        return Point2D(self.x + other.x, self.y + other.y)

    def __sub__(self, other: Point2D) -> Point2D:
        return Point2D(self.x - other.x, self.y - other.y)

    def __mul__(self, scalar: float) -> Point2D:
        return Point2D(self.x * scalar, self.y * scalar)


@dataclass
class DrawStyle:
    """Visual style for primitives."""

    stroke_color: tuple[int, int, int] = (255, 255, 255)
    fill_color: tuple[int, int, int] | None = None
    stroke_width: float = 2.0
    opacity: float = 1.0
    dash_pattern: list[float] | None = None  # e.g., [10, 5] for dashed
    line_cap: str = "round"  # round, square, butt
    line_join: str = "round"  # round, miter, bevel


class Primitive(ABC):
    """Base class for all drawable primitives."""

    def __init__(self) -> None:
        self._id = str(uuid.uuid4())[:8]
        self._style = DrawStyle()
        self._visible = True
        self._locked = False

    @property
    def id(self) -> str:
        """Unique identifier."""
        return self._id

    @property
    def style(self) -> DrawStyle:
        """Drawing style."""
        return self._style

    @style.setter
    def style(self, value: DrawStyle) -> None:
        self._style = value

    @property
    def visible(self) -> bool:
        return self._visible

    @visible.setter
    def visible(self, value: bool) -> None:
        self._visible = value

    @property
    def locked(self) -> bool:
        return self._locked

    @locked.setter
    def locked(self, value: bool) -> None:
        self._locked = value

    @property
    @abstractmethod
    def primitive_type(self) -> PrimitiveType:
        """Get the type of this primitive."""

    @abstractmethod
    def get_points(self) -> list[Point2D]:
        """Get defining points of this primitive."""

    @abstractmethod
    def get_bounds(self) -> tuple[Point2D, Point2D]:
        """Get bounding box as (min_point, max_point)."""

    @abstractmethod
    def contains_point(self, point: Point2D, tolerance: float = 5.0) -> bool:
        """Check if point is on or inside this primitive."""

    @abstractmethod
    def translate(self, dx: float, dy: float) -> None:
        """Translate the primitive by delta."""

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "id": self._id,
            "type": self.primitive_type.value,
            "style": {
                "stroke_color": self._style.stroke_color,
                "fill_color": self._style.fill_color,
                "stroke_width": self._style.stroke_width,
                "opacity": self._style.opacity,
            },
            "visible": self._visible,
            "locked": self._locked,
        }


@dataclass
class Line(Primitive):
    """Straight line segment between two points."""

    start: Point2D = field(default_factory=Point2D)
    end: Point2D = field(default_factory=Point2D)

    def __post_init__(self) -> None:
        super().__init__()

    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.LINE

    @property
    def length(self) -> float:
        """Get line length."""
        return self.start.distance_to(self.end)

    @property
    def angle(self) -> float:
        """Get line angle in radians."""
        return self.start.angle_to(self.end)

    @property
    def midpoint(self) -> Point2D:
        """Get midpoint of line."""
        return self.start.midpoint(self.end)

    def get_points(self) -> list[Point2D]:
        return [self.start, self.end]

    def get_bounds(self) -> tuple[Point2D, Point2D]:
        min_x = min(self.start.x, self.end.x)
        min_y = min(self.start.y, self.end.y)
        max_x = max(self.start.x, self.end.x)
        max_y = max(self.start.y, self.end.y)
        return (Point2D(min_x, min_y), Point2D(max_x, max_y))

    def contains_point(self, point: Point2D, tolerance: float = 5.0) -> bool:
        """Check if point is near the line segment."""
        # Vector math for point-to-line-segment distance
        px, py = point.x, point.y
        x1, y1 = self.start.x, self.start.y
        x2, y2 = self.end.x, self.end.y

        dx, dy = x2 - x1, y2 - y1
        length_sq = dx * dx + dy * dy

        if length_sq == 0:
            return point.distance_to(self.start) <= tolerance

        t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / length_sq))
        proj_x = x1 + t * dx
        proj_y = y1 + t * dy

        dist = math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)
        return dist <= tolerance

    def translate(self, dx: float, dy: float) -> None:
        self.start = self.start.translate(dx, dy)
        self.end = self.end.translate(dx, dy)

    def to_dict(self) -> dict[str, Any]:
        d = super().to_dict()
        d.update({
            "start": self.start.to_tuple(),
            "end": self.end.to_tuple(),
        })
        return d


@dataclass
class Arc(Primitive):
    """Circular arc defined by center, radius, and angles."""

    center: Point2D = field(default_factory=Point2D)
    radius: float = 50.0
    start_angle: float = 0.0  # Radians
    end_angle: float = math.pi  # Radians

    def __post_init__(self) -> None:
        super().__init__()

    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.ARC

    @property
    def arc_length(self) -> float:
        """Get arc length."""
        return abs(self.end_angle - self.start_angle) * self.radius

    def get_points(self) -> list[Point2D]:
        """Get start, mid, and end points of arc."""
        start = Point2D(
            self.center.x + self.radius * math.cos(self.start_angle),
            self.center.y + self.radius * math.sin(self.start_angle),
        )
        mid_angle = (self.start_angle + self.end_angle) / 2
        mid = Point2D(
            self.center.x + self.radius * math.cos(mid_angle),
            self.center.y + self.radius * math.sin(mid_angle),
        )
        end = Point2D(
            self.center.x + self.radius * math.cos(self.end_angle),
            self.center.y + self.radius * math.sin(self.end_angle),
        )
        return [start, mid, end]

    def get_bounds(self) -> tuple[Point2D, Point2D]:
        # Simplified: use full circle bounds
        return (
            Point2D(self.center.x - self.radius, self.center.y - self.radius),
            Point2D(self.center.x + self.radius, self.center.y + self.radius),
        )

    def contains_point(self, point: Point2D, tolerance: float = 5.0) -> bool:
        dist = point.distance_to(self.center)
        if abs(dist - self.radius) > tolerance:
            return False

        angle = math.atan2(point.y - self.center.y, point.x - self.center.x)
        # Normalize angles
        start = self.start_angle % (2 * math.pi)
        end = self.end_angle % (2 * math.pi)
        angle = angle % (2 * math.pi)

        if start <= end:
            return start <= angle <= end
        return angle >= start or angle <= end

    def translate(self, dx: float, dy: float) -> None:
        self.center = self.center.translate(dx, dy)


@dataclass
class BezierCurve(Primitive):
    """Cubic Bezier curve with 4 control points."""

    p0: Point2D = field(default_factory=Point2D)  # Start
    p1: Point2D = field(default_factory=Point2D)  # Control 1
    p2: Point2D = field(default_factory=Point2D)  # Control 2
    p3: Point2D = field(default_factory=Point2D)  # End

    def __post_init__(self) -> None:
        super().__init__()

    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.BEZIER

    def evaluate(self, t: float) -> Point2D:
        """Evaluate point on curve at parameter t (0-1)."""
        t2 = t * t
        t3 = t2 * t
        mt = 1 - t
        mt2 = mt * mt
        mt3 = mt2 * mt

        x = mt3 * self.p0.x + 3 * mt2 * t * self.p1.x + 3 * mt * t2 * self.p2.x + t3 * self.p3.x
        y = mt3 * self.p0.y + 3 * mt2 * t * self.p1.y + 3 * mt * t2 * self.p2.y + t3 * self.p3.y
        return Point2D(x, y)

    def get_points(self) -> list[Point2D]:
        return [self.p0, self.p1, self.p2, self.p3]

    def get_bounds(self) -> tuple[Point2D, Point2D]:
        # Sample curve for bounds
        points = [self.evaluate(t / 20) for t in range(21)]
        min_x = min(p.x for p in points)
        min_y = min(p.y for p in points)
        max_x = max(p.x for p in points)
        max_y = max(p.y for p in points)
        return (Point2D(min_x, min_y), Point2D(max_x, max_y))

    def contains_point(self, point: Point2D, tolerance: float = 5.0) -> bool:
        # Sample curve and check distances
        for i in range(21):
            curve_point = self.evaluate(i / 20)
            if point.distance_to(curve_point) <= tolerance:
                return True
        return False

    def translate(self, dx: float, dy: float) -> None:
        self.p0 = self.p0.translate(dx, dy)
        self.p1 = self.p1.translate(dx, dy)
        self.p2 = self.p2.translate(dx, dy)
        self.p3 = self.p3.translate(dx, dy)


@dataclass
class Rectangle(Primitive):
    """Rectangle defined by corner and dimensions."""

    origin: Point2D = field(default_factory=Point2D)
    width: float = 100.0
    height: float = 100.0
    rotation: float = 0.0  # Radians

    def __post_init__(self) -> None:
        super().__init__()

    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.RECTANGLE

    @property
    def center(self) -> Point2D:
        """Get center point of rectangle."""
        return Point2D(
            self.origin.x + self.width / 2,
            self.origin.y + self.height / 2,
        )

    def get_corners(self) -> list[Point2D]:
        """Get the four corners of the rectangle."""
        corners = [
            self.origin,
            Point2D(self.origin.x + self.width, self.origin.y),
            Point2D(self.origin.x + self.width, self.origin.y + self.height),
            Point2D(self.origin.x, self.origin.y + self.height),
        ]
        if self.rotation != 0:
            center = self.center
            corners = [c.rotate(self.rotation, center) for c in corners]
        return corners

    def get_points(self) -> list[Point2D]:
        return self.get_corners()

    def get_bounds(self) -> tuple[Point2D, Point2D]:
        corners = self.get_corners()
        min_x = min(c.x for c in corners)
        min_y = min(c.y for c in corners)
        max_x = max(c.x for c in corners)
        max_y = max(c.y for c in corners)
        return (Point2D(min_x, min_y), Point2D(max_x, max_y))

    def contains_point(self, point: Point2D, tolerance: float = 5.0) -> bool:
        # Transform point to local coordinates
        if self.rotation != 0:
            point = point.rotate(-self.rotation, self.center)

        return (
            self.origin.x - tolerance <= point.x <= self.origin.x + self.width + tolerance
            and self.origin.y - tolerance <= point.y <= self.origin.y + self.height + tolerance
        )

    def translate(self, dx: float, dy: float) -> None:
        self.origin = self.origin.translate(dx, dy)


@dataclass
class Circle(Primitive):
    """Circle defined by center and radius."""

    center: Point2D = field(default_factory=Point2D)
    radius: float = 50.0

    def __post_init__(self) -> None:
        super().__init__()

    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.CIRCLE

    @property
    def area(self) -> float:
        return math.pi * self.radius * self.radius

    @property
    def circumference(self) -> float:
        return 2 * math.pi * self.radius

    def get_points(self) -> list[Point2D]:
        # Return center and a point on circumference
        return [
            self.center,
            Point2D(self.center.x + self.radius, self.center.y),
        ]

    def get_bounds(self) -> tuple[Point2D, Point2D]:
        return (
            Point2D(self.center.x - self.radius, self.center.y - self.radius),
            Point2D(self.center.x + self.radius, self.center.y + self.radius),
        )

    def contains_point(self, point: Point2D, tolerance: float = 5.0) -> bool:
        dist = point.distance_to(self.center)
        # Check if on circumference or inside
        if self._style.fill_color is not None:
            return dist <= self.radius + tolerance
        return abs(dist - self.radius) <= tolerance

    def translate(self, dx: float, dy: float) -> None:
        self.center = self.center.translate(dx, dy)


@dataclass
class Polyline(Primitive):
    """Connected series of line segments."""

    points: list[Point2D] = field(default_factory=list)
    closed: bool = False  # If True, connects last point to first

    def __post_init__(self) -> None:
        super().__init__()

    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.POLYGON if self.closed else PrimitiveType.POLYLINE

    @property
    def segment_count(self) -> int:
        n = len(self.points)
        if n < 2:
            return 0
        return n if self.closed else n - 1

    def get_length(self) -> float:
        """Get total length of polyline."""
        if len(self.points) < 2:
            return 0.0
        total = sum(
            self.points[i].distance_to(self.points[i + 1])
            for i in range(len(self.points) - 1)
        )
        if self.closed and len(self.points) > 2:
            total += self.points[-1].distance_to(self.points[0])
        return total

    def add_point(self, point: Point2D) -> None:
        """Add a point to the polyline."""
        self.points.append(point)

    def get_points(self) -> list[Point2D]:
        return self.points.copy()

    def get_bounds(self) -> tuple[Point2D, Point2D]:
        if not self.points:
            return (Point2D(), Point2D())
        min_x = min(p.x for p in self.points)
        min_y = min(p.y for p in self.points)
        max_x = max(p.x for p in self.points)
        max_y = max(p.y for p in self.points)
        return (Point2D(min_x, min_y), Point2D(max_x, max_y))

    def contains_point(self, point: Point2D, tolerance: float = 5.0) -> bool:
        # Check each segment
        for i in range(len(self.points) - 1):
            line = Line(start=self.points[i], end=self.points[i + 1])
            if line.contains_point(point, tolerance):
                return True
        if self.closed and len(self.points) > 2:
            line = Line(start=self.points[-1], end=self.points[0])
            if line.contains_point(point, tolerance):
                return True
        return False

    def translate(self, dx: float, dy: float) -> None:
        self.points = [p.translate(dx, dy) for p in self.points]


@dataclass
class Freehand(Primitive):
    """Freehand sketch path with smoothing."""

    points: list[Point2D] = field(default_factory=list)
    smoothing: float = 0.5  # 0 = raw, 1 = heavily smoothed

    def __post_init__(self) -> None:
        super().__init__()

    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.FREEHAND

    def add_point(self, point: Point2D) -> None:
        """Add a point (during drawing)."""
        self.points.append(point)

    def smooth(self) -> None:
        """Apply smoothing to the path."""
        if len(self.points) < 3:
            return

        smoothed = [self.points[0]]
        for i in range(1, len(self.points) - 1):
            prev = self.points[i - 1]
            curr = self.points[i]
            next_p = self.points[i + 1]

            # Simple moving average
            w = self.smoothing
            x = curr.x * (1 - w) + (prev.x + next_p.x) / 2 * w
            y = curr.y * (1 - w) + (prev.y + next_p.y) / 2 * w
            smoothed.append(Point2D(x, y))

        smoothed.append(self.points[-1])
        self.points = smoothed

    def simplify(self, tolerance: float = 2.0) -> None:
        """Simplify path using Ramer-Douglas-Peucker algorithm."""
        if len(self.points) < 3:
            return

        def rdp(points: list[Point2D], epsilon: float) -> list[Point2D]:
            if len(points) < 3:
                return points

            # Find point with max distance from line
            line = Line(start=points[0], end=points[-1])
            max_dist = 0.0
            max_idx = 0

            for i in range(1, len(points) - 1):
                dist = self._point_to_line_dist(points[i], line)
                if dist > max_dist:
                    max_dist = dist
                    max_idx = i

            if max_dist > epsilon:
                left = rdp(points[: max_idx + 1], epsilon)
                right = rdp(points[max_idx:], epsilon)
                return left[:-1] + right
            return [points[0], points[-1]]

        self.points = rdp(self.points, tolerance)

    def _point_to_line_dist(self, point: Point2D, line: Line) -> float:
        """Calculate perpendicular distance from point to line."""
        px, py = point.x, point.y
        x1, y1 = line.start.x, line.start.y
        x2, y2 = line.end.x, line.end.y

        dx, dy = x2 - x1, y2 - y1
        length_sq = dx * dx + dy * dy

        if length_sq == 0:
            return point.distance_to(line.start)

        t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / length_sq))
        proj_x = x1 + t * dx
        proj_y = y1 + t * dy

        return math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)

    def get_points(self) -> list[Point2D]:
        return self.points.copy()

    def get_bounds(self) -> tuple[Point2D, Point2D]:
        if not self.points:
            return (Point2D(), Point2D())
        min_x = min(p.x for p in self.points)
        min_y = min(p.y for p in self.points)
        max_x = max(p.x for p in self.points)
        max_y = max(p.y for p in self.points)
        return (Point2D(min_x, min_y), Point2D(max_x, max_y))

    def contains_point(self, point: Point2D, tolerance: float = 5.0) -> bool:
        for i in range(len(self.points) - 1):
            line = Line(start=self.points[i], end=self.points[i + 1])
            if line.contains_point(point, tolerance):
                return True
        return False

    def translate(self, dx: float, dy: float) -> None:
        self.points = [p.translate(dx, dy) for p in self.points]
