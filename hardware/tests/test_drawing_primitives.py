"""Tests for drawing primitives module."""

from __future__ import annotations

import math
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
    PrimitiveType,
    Rectangle,
)


class TestPoint2D:
    """Tests for Point2D dataclass."""

    def test_point_creation(self) -> None:
        """Test point creation."""
        p = Point2D(10, 20)
        assert p.x == 10
        assert p.y == 20

    def test_point_defaults(self) -> None:
        """Test default values."""
        p = Point2D()
        assert p.x == 0.0
        assert p.y == 0.0

    def test_point_distance(self) -> None:
        """Test distance calculation."""
        p1 = Point2D(0, 0)
        p2 = Point2D(3, 4)
        assert p1.distance_to(p2) == pytest.approx(5.0)

    def test_point_addition(self) -> None:
        """Test point addition."""
        p1 = Point2D(10, 20)
        p2 = Point2D(5, 10)
        result = p1 + p2
        assert result.x == 15
        assert result.y == 30

    def test_point_subtraction(self) -> None:
        """Test point subtraction."""
        p1 = Point2D(10, 20)
        p2 = Point2D(5, 10)
        result = p1 - p2
        assert result.x == 5
        assert result.y == 10

    def test_point_multiplication(self) -> None:
        """Test scalar multiplication."""
        p = Point2D(10, 20)
        result = p * 2
        assert result.x == 20
        assert result.y == 40

    def test_point_angle_to(self) -> None:
        """Test angle calculation."""
        p1 = Point2D(0, 0)
        p2 = Point2D(1, 0)  # Right
        assert p1.angle_to(p2) == pytest.approx(0)

        p3 = Point2D(0, 1)  # Up
        assert p1.angle_to(p3) == pytest.approx(math.pi / 2)

    def test_point_midpoint(self) -> None:
        """Test midpoint calculation."""
        p1 = Point2D(0, 0)
        p2 = Point2D(10, 10)
        mid = p1.midpoint(p2)
        assert mid.x == 5
        assert mid.y == 5

    def test_point_rotate(self) -> None:
        """Test point rotation."""
        p = Point2D(1, 0)
        rotated = p.rotate(math.pi / 2)  # 90 degrees
        assert rotated.x == pytest.approx(0, abs=0.0001)
        assert rotated.y == pytest.approx(1, abs=0.0001)

    def test_point_translate(self) -> None:
        """Test point translation."""
        p = Point2D(10, 20)
        translated = p.translate(5, 10)
        assert translated.x == 15
        assert translated.y == 30

    def test_point_scale(self) -> None:
        """Test point scaling."""
        p = Point2D(10, 10)
        scaled = p.scale(2)
        assert scaled.x == 20
        assert scaled.y == 20

    def test_point_to_tuple(self) -> None:
        """Test tuple conversion."""
        p = Point2D(10, 20)
        assert p.to_tuple() == (10, 20)

    def test_point_from_tuple(self) -> None:
        """Test creation from tuple."""
        p = Point2D.from_tuple((10.5, 20.5))
        assert p.x == 10.5
        assert p.y == 20.5


class TestDrawStyle:
    """Tests for DrawStyle dataclass."""

    def test_style_defaults(self) -> None:
        """Test default style values."""
        style = DrawStyle()
        assert style.stroke_color == (255, 255, 255)  # White
        assert style.fill_color is None
        assert style.stroke_width == 2.0
        assert style.opacity == 1.0

    def test_style_custom(self) -> None:
        """Test custom style values."""
        style = DrawStyle(
            stroke_color=(255, 0, 0),
            fill_color=(0, 255, 0),
            stroke_width=5.0,
            opacity=0.5,
        )
        assert style.stroke_color == (255, 0, 0)
        assert style.fill_color == (0, 255, 0)
        assert style.stroke_width == 5.0
        assert style.opacity == 0.5


class TestLine:
    """Tests for Line primitive."""

    def test_line_creation(self) -> None:
        """Test line creation."""
        line = Line(
            start=Point2D(0, 0),
            end=Point2D(100, 0),
        )
        assert line.start.x == 0
        assert line.end.x == 100
        assert line.primitive_type == PrimitiveType.LINE

    def test_line_length(self) -> None:
        """Test line length."""
        line = Line(
            start=Point2D(0, 0),
            end=Point2D(3, 4),
        )
        assert line.length == pytest.approx(5.0)

    def test_line_midpoint(self) -> None:
        """Test line midpoint."""
        line = Line(
            start=Point2D(0, 0),
            end=Point2D(100, 100),
        )
        mid = line.midpoint
        assert mid.x == 50
        assert mid.y == 50

    def test_line_angle(self) -> None:
        """Test line angle."""
        line = Line(
            start=Point2D(0, 0),
            end=Point2D(1, 0),  # Horizontal right
        )
        assert line.angle == pytest.approx(0)

    def test_line_get_bounds(self) -> None:
        """Test line bounds."""
        line = Line(
            start=Point2D(10, 20),
            end=Point2D(100, 80),
        )
        min_pt, max_pt = line.get_bounds()
        assert min_pt.x == 10
        assert min_pt.y == 20
        assert max_pt.x == 100
        assert max_pt.y == 80

    def test_line_contains_point(self) -> None:
        """Test point containment."""
        line = Line(
            start=Point2D(0, 0),
            end=Point2D(100, 0),
        )
        # Point on line
        assert line.contains_point(Point2D(50, 0))
        # Point near line
        assert line.contains_point(Point2D(50, 3), tolerance=5)
        # Point far from line
        assert not line.contains_point(Point2D(50, 20), tolerance=5)

    def test_line_translate(self) -> None:
        """Test line translation."""
        line = Line(
            start=Point2D(0, 0),
            end=Point2D(100, 0),
        )
        line.translate(10, 20)
        assert line.start.x == 10
        assert line.start.y == 20
        assert line.end.x == 110
        assert line.end.y == 20


class TestRectangle:
    """Tests for Rectangle primitive."""

    def test_rectangle_creation(self) -> None:
        """Test rectangle creation."""
        rect = Rectangle(
            origin=Point2D(10, 20),
            width=100,
            height=50,
        )
        assert rect.origin.x == 10
        assert rect.origin.y == 20
        assert rect.width == 100
        assert rect.height == 50
        assert rect.primitive_type == PrimitiveType.RECTANGLE

    def test_rectangle_center(self) -> None:
        """Test rectangle center."""
        rect = Rectangle(
            origin=Point2D(0, 0),
            width=100,
            height=100,
        )
        center = rect.center
        assert center.x == 50
        assert center.y == 50

    def test_rectangle_corners(self) -> None:
        """Test rectangle corners."""
        rect = Rectangle(
            origin=Point2D(0, 0),
            width=100,
            height=50,
        )
        corners = rect.get_corners()
        assert len(corners) == 4
        # Check corners clockwise from origin
        assert corners[0].x == 0 and corners[0].y == 0
        assert corners[1].x == 100 and corners[1].y == 0
        assert corners[2].x == 100 and corners[2].y == 50
        assert corners[3].x == 0 and corners[3].y == 50

    def test_rectangle_get_bounds(self) -> None:
        """Test rectangle bounds."""
        rect = Rectangle(
            origin=Point2D(10, 20),
            width=100,
            height=50,
        )
        min_pt, max_pt = rect.get_bounds()
        assert min_pt.x == 10
        assert min_pt.y == 20
        assert max_pt.x == 110
        assert max_pt.y == 70

    def test_rectangle_contains_point(self) -> None:
        """Test point containment."""
        rect = Rectangle(
            origin=Point2D(0, 0),
            width=100,
            height=100,
        )
        # Inside
        assert rect.contains_point(Point2D(50, 50))
        # On edge
        assert rect.contains_point(Point2D(0, 50))
        # Outside
        assert not rect.contains_point(Point2D(-20, 50), tolerance=5)


class TestCircle:
    """Tests for Circle primitive."""

    def test_circle_creation(self) -> None:
        """Test circle creation."""
        circle = Circle(
            center=Point2D(50, 50),
            radius=25,
        )
        assert circle.center.x == 50
        assert circle.center.y == 50
        assert circle.radius == 25
        assert circle.primitive_type == PrimitiveType.CIRCLE

    def test_circle_area(self) -> None:
        """Test circle area."""
        circle = Circle(radius=10)
        assert circle.area == pytest.approx(math.pi * 100)

    def test_circle_circumference(self) -> None:
        """Test circle circumference."""
        circle = Circle(radius=10)
        assert circle.circumference == pytest.approx(2 * math.pi * 10)

    def test_circle_get_bounds(self) -> None:
        """Test circle bounds."""
        circle = Circle(
            center=Point2D(50, 50),
            radius=25,
        )
        min_pt, max_pt = circle.get_bounds()
        assert min_pt.x == 25
        assert min_pt.y == 25
        assert max_pt.x == 75
        assert max_pt.y == 75

    def test_circle_contains_point_on_edge(self) -> None:
        """Test point on circumference."""
        circle = Circle(
            center=Point2D(0, 0),
            radius=50,
        )
        # Point on circumference
        assert circle.contains_point(Point2D(50, 0))


class TestArc:
    """Tests for Arc primitive."""

    def test_arc_creation(self) -> None:
        """Test arc creation."""
        arc = Arc(
            center=Point2D(50, 50),
            radius=25,
            start_angle=0,
            end_angle=math.pi,
        )
        assert arc.center.x == 50
        assert arc.radius == 25
        assert arc.primitive_type == PrimitiveType.ARC

    def test_arc_length(self) -> None:
        """Test arc length."""
        arc = Arc(
            radius=10,
            start_angle=0,
            end_angle=math.pi,  # Half circle
        )
        assert arc.arc_length == pytest.approx(math.pi * 10)

    def test_arc_get_points(self) -> None:
        """Test arc points (start, mid, end)."""
        arc = Arc(
            center=Point2D(0, 0),
            radius=10,
            start_angle=0,
            end_angle=math.pi,
        )
        points = arc.get_points()
        assert len(points) == 3
        # Start point at angle 0
        assert points[0].x == pytest.approx(10)
        assert points[0].y == pytest.approx(0)
        # End point at angle pi
        assert points[2].x == pytest.approx(-10, abs=0.001)
        assert points[2].y == pytest.approx(0, abs=0.001)


class TestPolyline:
    """Tests for Polyline primitive."""

    def test_polyline_creation(self) -> None:
        """Test polyline creation."""
        points = [Point2D(0, 0), Point2D(50, 50), Point2D(100, 0)]
        polyline = Polyline(points=points)
        assert len(polyline.points) == 3
        assert polyline.primitive_type == PrimitiveType.POLYLINE

    def test_polyline_closed(self) -> None:
        """Test closed polyline (polygon)."""
        points = [Point2D(0, 0), Point2D(50, 50), Point2D(100, 0)]
        polyline = Polyline(points=points, closed=True)
        assert polyline.closed is True
        assert polyline.primitive_type == PrimitiveType.POLYGON

    def test_polyline_get_bounds(self) -> None:
        """Test polyline bounds."""
        points = [Point2D(10, 20), Point2D(50, 100), Point2D(80, 30)]
        polyline = Polyline(points=points)
        min_pt, max_pt = polyline.get_bounds()
        assert min_pt.x == 10
        assert min_pt.y == 20
        assert max_pt.x == 80
        assert max_pt.y == 100


class TestBezierCurve:
    """Tests for BezierCurve primitive."""

    def test_bezier_creation(self) -> None:
        """Test bezier curve creation."""
        bezier = BezierCurve(
            p0=Point2D(0, 0),
            p1=Point2D(25, 50),
            p2=Point2D(75, 50),
            p3=Point2D(100, 0),
        )
        assert bezier.p0.x == 0
        assert bezier.p3.x == 100
        assert bezier.primitive_type == PrimitiveType.BEZIER

    def test_bezier_evaluate(self) -> None:
        """Test bezier evaluation."""
        bezier = BezierCurve(
            p0=Point2D(0, 0),
            p1=Point2D(0, 100),
            p2=Point2D(100, 100),
            p3=Point2D(100, 0),
        )
        # Start point
        start = bezier.evaluate(0)
        assert start.x == pytest.approx(0)
        assert start.y == pytest.approx(0)

        # End point
        end = bezier.evaluate(1)
        assert end.x == pytest.approx(100)
        assert end.y == pytest.approx(0)

        # Mid point should be somewhere in between
        mid = bezier.evaluate(0.5)
        assert 0 < mid.x < 100
        assert mid.y > 0

    def test_bezier_get_points(self) -> None:
        """Test bezier control points."""
        bezier = BezierCurve(
            p0=Point2D(0, 0),
            p1=Point2D(25, 50),
            p2=Point2D(75, 50),
            p3=Point2D(100, 0),
        )
        points = bezier.get_points()
        assert len(points) == 4


class TestFreehand:
    """Tests for Freehand primitive."""

    def test_freehand_creation(self) -> None:
        """Test freehand creation."""
        freehand = Freehand()
        assert freehand.primitive_type == PrimitiveType.FREEHAND
        assert len(freehand.points) == 0

    def test_freehand_add_points(self) -> None:
        """Test adding points to freehand."""
        freehand = Freehand()
        freehand.add_point(Point2D(0, 0))
        freehand.add_point(Point2D(10, 10))
        freehand.add_point(Point2D(20, 15))

        assert len(freehand.points) == 3
