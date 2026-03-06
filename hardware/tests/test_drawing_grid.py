"""Tests for GridSystem, GridConfig, and SnapResult."""

from __future__ import annotations

import math

from core.blueprint.drawing.grid import (
    GridConfig,
    GridSystem,
    GridType,
    SnapMode,
    SnapResult,
)
from core.blueprint.drawing.primitives import (
    Arc,
    Circle,
    Line,
    Point2D,
    Polyline,
    Rectangle,
)


# ── GridConfig ───────────────────────────────────────────────────────


class TestGridConfig:
    def test_defaults(self) -> None:
        cfg = GridConfig()
        assert cfg.major_spacing == 100.0
        assert cfg.minor_divisions == 4
        assert cfg.minor_spacing == 25.0

    def test_minor_spacing_zero_divs(self) -> None:
        cfg = GridConfig(minor_divisions=0)
        assert cfg.minor_spacing == 100.0


class TestSnapResult:
    def test_defaults(self) -> None:
        r = SnapResult()
        assert not r.snapped
        assert r.snap_mode is None


# ── GridSystem basics ────────────────────────────────────────────────


class TestGridSystemBasics:
    def test_defaults(self) -> None:
        g = GridSystem()
        assert g.config.grid_type == GridType.LINES
        assert g.snap_tolerance == 10.0
        assert g.is_snap_enabled(SnapMode.GRID)

    def test_config_setter(self) -> None:
        g = GridSystem()
        new = GridConfig(major_spacing=50)
        g.config = new
        assert g.config.major_spacing == 50

    def test_snap_tolerance_clamped(self) -> None:
        g = GridSystem()
        g.snap_tolerance = -5
        assert g.snap_tolerance >= 1.0

    def test_enable_disable(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        assert not g.is_snap_enabled(SnapMode.GRID)
        g.enable_snap(SnapMode.GRID)
        assert g.is_snap_enabled(SnapMode.GRID)

    def test_toggle(self) -> None:
        g = GridSystem()
        assert g.is_snap_enabled(SnapMode.GRID)
        assert g.toggle_snap(SnapMode.GRID) is False
        assert not g.is_snap_enabled(SnapMode.GRID)
        assert g.toggle_snap(SnapMode.GRID) is True
        assert g.is_snap_enabled(SnapMode.GRID)


# ── snap_to_grid ─────────────────────────────────────────────────────


class TestSnapToGrid:
    def test_snaps_to_nearest(self) -> None:
        g = GridSystem(GridConfig(major_spacing=100, minor_divisions=4))
        # minor_spacing = 25; point (12, 12) → (0, 0) if within tolerance=10
        # distance from (12,12) to (0,0) ~ 17, but to (25,25) ~ 18; out of 10
        # Let's pick a point very close to grid intersection
        r = g.snap_to_grid(26.0, 26.0)
        # Nearest grid = (25, 25); distance ≈ 1.41
        assert r.snapped
        assert r.point == (25.0, 25.0)
        assert r.snap_mode == SnapMode.GRID

    def test_too_far_no_snap(self) -> None:
        g = GridSystem(GridConfig(major_spacing=100, minor_divisions=1))
        # minor = 100; nearest grid (0,0) but point at (45, 45) dist ~63
        r = g.snap_to_grid(45.0, 45.0)
        assert not r.snapped

    def test_grid_disabled(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        r = g.snap_to_grid(1.0, 1.0)
        assert not r.snapped


# ── snap (combined) ──────────────────────────────────────────────────


class TestSnapCombined:
    def test_no_prims(self) -> None:
        g = GridSystem()
        r = g.snap(26.0, 1.0)  # close to (25, 0)
        assert r.snapped

    def test_no_snap_returns_original(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        r = g.snap(33.3, 44.4)
        assert not r.snapped
        assert r.point == (33.3, 44.4)

    def test_endpoint_snap(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        g.enable_snap(SnapMode.ENDPOINT)
        line = Line(start=Point2D(100, 100), end=Point2D(200, 200))
        r = g.snap(101.0, 101.0, primitives=[line])
        assert r.snapped
        assert r.snap_mode == SnapMode.ENDPOINT

    def test_midpoint_snap_line(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        g.enable_snap(SnapMode.MIDPOINT)
        line = Line(start=Point2D(0, 0), end=Point2D(100, 0))
        r = g.snap(51.0, 0.0, primitives=[line])
        assert r.snapped
        assert r.snap_mode == SnapMode.MIDPOINT

    def test_midpoint_snap_polyline(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        g.enable_snap(SnapMode.MIDPOINT)
        poly = Polyline(points=[Point2D(0, 0), Point2D(100, 0), Point2D(100, 100)])
        r = g.snap(51.0, 0.0, primitives=[poly])
        assert r.snapped

    def test_center_snap_circle(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        g.enable_snap(SnapMode.CENTER)
        circ = Circle(center=Point2D(50, 50), radius=30)
        r = g.snap(51.0, 51.0, primitives=[circ])
        assert r.snapped
        assert r.snap_mode == SnapMode.CENTER
        assert r.point == (50.0, 50.0)

    def test_center_snap_arc(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        g.enable_snap(SnapMode.CENTER)
        arc = Arc(center=Point2D(50, 50), radius=30)
        r = g.snap(51.0, 51.0, primitives=[arc])
        assert r.snapped

    def test_center_snap_rectangle(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        g.enable_snap(SnapMode.CENTER)
        rect = Rectangle(origin=Point2D(0, 0), width=100, height=100)
        r = g.snap(51.0, 51.0, primitives=[rect])
        assert r.snapped
        assert r.snap_mode == SnapMode.CENTER

    def test_nearest_snap(self) -> None:
        g = GridSystem()
        g.disable_snap(SnapMode.GRID)
        g.enable_snap(SnapMode.NEAREST)
        line = Line(start=Point2D(0, 0), end=Point2D(100, 0))
        r = g.snap(1.0, 1.0, primitives=[line])
        assert r.snapped
        assert r.snap_mode == SnapMode.NEAREST

    def test_closest_wins(self) -> None:
        """When multiple snaps fire, the closest one is returned."""
        g = GridSystem()
        g.enable_snap(SnapMode.ENDPOINT)
        line = Line(start=Point2D(25, 0), end=Point2D(200, 0))
        r = g.snap(25.5, 0.5, primitives=[line])
        assert r.snapped
        # Either grid (25,0) or endpoint (25,0) — both close


# ── constrain_angle ──────────────────────────────────────────────────


class TestConstrainAngle:
    def test_horizontal(self) -> None:
        g = GridSystem()
        x, y = g.constrain_angle(0, 0, 100, 1)
        assert abs(y) < 1e-6  # constrained to 0° → y ≈ 0

    def test_45_degree(self) -> None:
        g = GridSystem()
        x, y = g.constrain_angle(0, 0, 100, 95)
        assert abs(x - y) < 1e-6  # constrained to 45°

    def test_zero_distance(self) -> None:
        g = GridSystem()
        x, y = g.constrain_angle(50, 50, 50, 50)
        assert (x, y) == (50, 50)

    def test_custom_angles(self) -> None:
        g = GridSystem()
        x, y = g.constrain_angle(0, 0, 100, 5, angles=[0, 90])
        # closest to ~2.86° → 0°
        assert abs(y) < 1e-6


# ── get_grid_lines ───────────────────────────────────────────────────


class TestGetGridLines:
    def test_no_grid(self) -> None:
        g = GridSystem(GridConfig(grid_type=GridType.NONE))
        major, minor = g.get_grid_lines(0, 0, 100, 100)
        assert major == []
        assert minor == []

    def test_returns_lines(self) -> None:
        g = GridSystem(GridConfig(major_spacing=50, minor_divisions=2))
        major, minor = g.get_grid_lines(0, 0, 100, 100)
        assert len(major) > 0
        assert len(minor) > 0

    def test_no_minor_when_disabled(self) -> None:
        g = GridSystem(GridConfig(major_spacing=50, show_minor=False))
        major, minor = g.get_grid_lines(0, 0, 100, 100)
        assert len(major) > 0
        assert minor == []
