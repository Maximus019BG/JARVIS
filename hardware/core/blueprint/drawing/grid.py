"""Grid system with snap-to-grid functionality.

Provides configurable grid display and snapping for precise drawing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.blueprint.drawing.primitives import Point2D


class GridType(str, Enum):
    """Grid visualization types."""

    LINES = "lines"  # Standard grid lines
    DOTS = "dots"  # Dot grid
    ISOMETRIC = "isometric"  # Isometric grid for 3D-ish drawing
    NONE = "none"  # No grid


class SnapMode(str, Enum):
    """Snap target types."""

    GRID = "grid"  # Snap to grid intersections
    ENDPOINT = "endpoint"  # Snap to primitive endpoints
    MIDPOINT = "midpoint"  # Snap to midpoints
    CENTER = "center"  # Snap to centers
    INTERSECTION = "intersection"  # Snap to intersections
    PERPENDICULAR = "perpendicular"  # Snap to perpendicular points
    TANGENT = "tangent"  # Snap to tangent points
    NEAREST = "nearest"  # Snap to nearest point on geometry


@dataclass
class GridConfig:
    """Grid configuration."""

    grid_type: GridType = GridType.LINES
    major_spacing: float = 100.0  # Major grid line spacing
    minor_divisions: int = 4  # Minor divisions between major lines
    show_major: bool = True
    show_minor: bool = True
    major_color: tuple[int, int, int] = (80, 80, 80)
    minor_color: tuple[int, int, int] = (50, 50, 50)
    origin_color: tuple[int, int, int] = (120, 80, 80)
    show_origin: bool = True
    unit: str = "mm"

    @property
    def minor_spacing(self) -> float:
        """Get minor grid spacing."""
        return self.major_spacing / self.minor_divisions if self.minor_divisions > 0 else self.major_spacing


@dataclass
class SnapResult:
    """Result of a snap operation."""

    snapped: bool = False
    point: tuple[float, float] = (0.0, 0.0)
    snap_mode: SnapMode | None = None
    distance: float = float("inf")
    target_id: str | None = None  # ID of primitive snapped to


class GridSystem:
    """Grid and snapping manager.

    Manages grid display configuration and provides snap-to-grid
    and snap-to-geometry functionality.

    Usage:
        grid = GridSystem()
        result = grid.snap(x, y)
        if result.snapped:
            x, y = result.point
    """

    def __init__(self, config: GridConfig | None = None) -> None:
        """Initialize grid system.

        Args:
            config: Grid configuration.
        """
        self._config = config or GridConfig()
        self._enabled_snaps: set[SnapMode] = {SnapMode.GRID}
        self._snap_tolerance: float = 10.0

    @property
    def config(self) -> GridConfig:
        """Get grid configuration."""
        return self._config

    @config.setter
    def config(self, value: GridConfig) -> None:
        """Set grid configuration."""
        self._config = value

    @property
    def snap_tolerance(self) -> float:
        """Get snap tolerance in pixels."""
        return self._snap_tolerance

    @snap_tolerance.setter
    def snap_tolerance(self, value: float) -> None:
        """Set snap tolerance."""
        self._snap_tolerance = max(1.0, value)

    def enable_snap(self, mode: SnapMode) -> None:
        """Enable a snap mode."""
        self._enabled_snaps.add(mode)

    def disable_snap(self, mode: SnapMode) -> None:
        """Disable a snap mode."""
        self._enabled_snaps.discard(mode)

    def toggle_snap(self, mode: SnapMode) -> bool:
        """Toggle a snap mode. Returns new state."""
        if mode in self._enabled_snaps:
            self._enabled_snaps.discard(mode)
            return False
        self._enabled_snaps.add(mode)
        return True

    def is_snap_enabled(self, mode: SnapMode) -> bool:
        """Check if a snap mode is enabled."""
        return mode in self._enabled_snaps

    def snap_to_grid(self, x: float, y: float) -> SnapResult:
        """Snap point to nearest grid intersection.

        Args:
            x: X coordinate.
            y: Y coordinate.

        Returns:
            SnapResult with snapped position.
        """
        if SnapMode.GRID not in self._enabled_snaps:
            return SnapResult(snapped=False, point=(x, y))

        spacing = self._config.minor_spacing

        # Round to nearest grid point
        snap_x = round(x / spacing) * spacing
        snap_y = round(y / spacing) * spacing

        distance = math.sqrt((x - snap_x) ** 2 + (y - snap_y) ** 2)

        if distance <= self._snap_tolerance:
            return SnapResult(
                snapped=True,
                point=(snap_x, snap_y),
                snap_mode=SnapMode.GRID,
                distance=distance,
            )

        return SnapResult(snapped=False, point=(x, y), distance=distance)

    def snap(
        self,
        x: float,
        y: float,
        primitives: list | None = None,
    ) -> SnapResult:
        """Snap to the best available target.

        Checks all enabled snap modes and returns the closest snap.

        Args:
            x: X coordinate.
            y: Y coordinate.
            primitives: Optional list of primitives to snap to.

        Returns:
            SnapResult with best snap position.
        """
        results: list[SnapResult] = []

        # Try grid snap
        if SnapMode.GRID in self._enabled_snaps:
            grid_result = self.snap_to_grid(x, y)
            if grid_result.snapped:
                results.append(grid_result)

        # Try geometry snaps if primitives provided
        if primitives:
            if SnapMode.ENDPOINT in self._enabled_snaps:
                result = self._snap_to_endpoints(x, y, primitives)
                if result.snapped:
                    results.append(result)

            if SnapMode.MIDPOINT in self._enabled_snaps:
                result = self._snap_to_midpoints(x, y, primitives)
                if result.snapped:
                    results.append(result)

            if SnapMode.CENTER in self._enabled_snaps:
                result = self._snap_to_centers(x, y, primitives)
                if result.snapped:
                    results.append(result)

            if SnapMode.NEAREST in self._enabled_snaps:
                result = self._snap_to_nearest(x, y, primitives)
                if result.snapped:
                    results.append(result)

        # Return closest snap
        if results:
            results.sort(key=lambda r: r.distance)
            return results[0]

        return SnapResult(snapped=False, point=(x, y))

    def _snap_to_endpoints(
        self, x: float, y: float, primitives: list
    ) -> SnapResult:
        """Snap to primitive endpoints."""
        from core.blueprint.drawing.primitives import Primitive

        best_dist = float("inf")
        best_point = (x, y)
        best_id = None

        for prim in primitives:
            if not isinstance(prim, Primitive):
                continue

            for point in prim.get_points():
                dist = math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2)
                if dist < best_dist and dist <= self._snap_tolerance:
                    best_dist = dist
                    best_point = (point.x, point.y)
                    best_id = prim.id

        if best_dist <= self._snap_tolerance:
            return SnapResult(
                snapped=True,
                point=best_point,
                snap_mode=SnapMode.ENDPOINT,
                distance=best_dist,
                target_id=best_id,
            )

        return SnapResult(snapped=False, point=(x, y))

    def _snap_to_midpoints(
        self, x: float, y: float, primitives: list
    ) -> SnapResult:
        """Snap to midpoints of line segments."""
        from core.blueprint.drawing.primitives import Line, Polyline

        best_dist = float("inf")
        best_point = (x, y)
        best_id = None

        for prim in primitives:
            if isinstance(prim, Line):
                mid = prim.midpoint
                dist = math.sqrt((x - mid.x) ** 2 + (y - mid.y) ** 2)
                if dist < best_dist and dist <= self._snap_tolerance:
                    best_dist = dist
                    best_point = (mid.x, mid.y)
                    best_id = prim.id

            elif isinstance(prim, Polyline):
                points = prim.get_points()
                for i in range(len(points) - 1):
                    mid_x = (points[i].x + points[i + 1].x) / 2
                    mid_y = (points[i].y + points[i + 1].y) / 2
                    dist = math.sqrt((x - mid_x) ** 2 + (y - mid_y) ** 2)
                    if dist < best_dist and dist <= self._snap_tolerance:
                        best_dist = dist
                        best_point = (mid_x, mid_y)
                        best_id = prim.id

        if best_dist <= self._snap_tolerance:
            return SnapResult(
                snapped=True,
                point=best_point,
                snap_mode=SnapMode.MIDPOINT,
                distance=best_dist,
                target_id=best_id,
            )

        return SnapResult(snapped=False, point=(x, y))

    def _snap_to_centers(
        self, x: float, y: float, primitives: list
    ) -> SnapResult:
        """Snap to centers of circles and rectangles."""
        from core.blueprint.drawing.primitives import Circle, Rectangle, Arc

        best_dist = float("inf")
        best_point = (x, y)
        best_id = None

        for prim in primitives:
            center = None

            if isinstance(prim, Circle):
                center = prim.center
            elif isinstance(prim, Arc):
                center = prim.center
            elif isinstance(prim, Rectangle):
                center = prim.center

            if center:
                dist = math.sqrt((x - center.x) ** 2 + (y - center.y) ** 2)
                if dist < best_dist and dist <= self._snap_tolerance:
                    best_dist = dist
                    best_point = (center.x, center.y)
                    best_id = prim.id

        if best_dist <= self._snap_tolerance:
            return SnapResult(
                snapped=True,
                point=best_point,
                snap_mode=SnapMode.CENTER,
                distance=best_dist,
                target_id=best_id,
            )

        return SnapResult(snapped=False, point=(x, y))

    def _snap_to_nearest(
        self, x: float, y: float, primitives: list
    ) -> SnapResult:
        """Snap to nearest point on any primitive."""
        from core.blueprint.drawing.primitives import Primitive, Point2D

        best_dist = float("inf")
        best_point = (x, y)
        best_id = None

        test_point = Point2D(x, y)

        for prim in primitives:
            if not isinstance(prim, Primitive):
                continue

            if prim.contains_point(test_point, self._snap_tolerance):
                # For lines, find the actual nearest point
                points = prim.get_points()
                for pt in points:
                    dist = math.sqrt((x - pt.x) ** 2 + (y - pt.y) ** 2)
                    if dist < best_dist:
                        best_dist = dist
                        best_point = (pt.x, pt.y)
                        best_id = prim.id

        if best_dist <= self._snap_tolerance:
            return SnapResult(
                snapped=True,
                point=best_point,
                snap_mode=SnapMode.NEAREST,
                distance=best_dist,
                target_id=best_id,
            )

        return SnapResult(snapped=False, point=(x, y))

    def constrain_angle(
        self,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        angles: list[float] | None = None,
    ) -> tuple[float, float]:
        """Constrain end point to specific angles from start.

        Args:
            start_x: Start X.
            start_y: Start Y.
            end_x: End X.
            end_y: End Y.
            angles: List of allowed angles in degrees. Default [0, 45, 90, 135, 180, 225, 270, 315].

        Returns:
            Constrained (x, y) for end point.
        """
        if angles is None:
            angles = [0, 45, 90, 135, 180, 225, 270, 315]

        # Get current angle and distance
        dx = end_x - start_x
        dy = end_y - start_y
        distance = math.sqrt(dx * dx + dy * dy)

        if distance < 0.01:
            return (end_x, end_y)

        current_angle = math.degrees(math.atan2(dy, dx))

        # Find closest allowed angle
        closest_angle = min(
            angles,
            key=lambda a: min(abs(current_angle - a), abs(current_angle - a + 360), abs(current_angle - a - 360))
        )

        # Calculate new end point
        rad = math.radians(closest_angle)
        new_x = start_x + distance * math.cos(rad)
        new_y = start_y + distance * math.sin(rad)

        return (new_x, new_y)

    def get_grid_lines(
        self,
        view_min_x: float,
        view_min_y: float,
        view_max_x: float,
        view_max_y: float,
    ) -> tuple[list[tuple[float, float, float, float]], list[tuple[float, float, float, float]]]:
        """Get grid lines for rendering.

        Args:
            view_min_x: Minimum X of view.
            view_min_y: Minimum Y of view.
            view_max_x: Maximum X of view.
            view_max_y: Maximum Y of view.

        Returns:
            Tuple of (major_lines, minor_lines) where each line is (x1, y1, x2, y2).
        """
        major_lines: list[tuple[float, float, float, float]] = []
        minor_lines: list[tuple[float, float, float, float]] = []

        if self._config.grid_type == GridType.NONE:
            return (major_lines, minor_lines)

        major_spacing = self._config.major_spacing
        minor_spacing = self._config.minor_spacing

        # Calculate grid range
        start_major_x = math.floor(view_min_x / major_spacing) * major_spacing
        end_major_x = math.ceil(view_max_x / major_spacing) * major_spacing
        start_major_y = math.floor(view_min_y / major_spacing) * major_spacing
        end_major_y = math.ceil(view_max_y / major_spacing) * major_spacing

        # Generate vertical lines
        x = start_major_x
        while x <= end_major_x:
            major_lines.append((x, view_min_y, x, view_max_y))
            if self._config.show_minor:
                for i in range(1, self._config.minor_divisions):
                    minor_x = x + i * minor_spacing
                    if minor_x <= end_major_x:
                        minor_lines.append((minor_x, view_min_y, minor_x, view_max_y))
            x += major_spacing

        # Generate horizontal lines
        y = start_major_y
        while y <= end_major_y:
            major_lines.append((view_min_x, y, view_max_x, y))
            if self._config.show_minor:
                for i in range(1, self._config.minor_divisions):
                    minor_y = y + i * minor_spacing
                    if minor_y <= end_major_y:
                        minor_lines.append((view_min_x, minor_y, view_max_x, minor_y))
            y += major_spacing

        return (major_lines, minor_lines)
