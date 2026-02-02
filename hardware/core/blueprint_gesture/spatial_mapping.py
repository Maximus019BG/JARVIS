"""Maps hand positions in camera space to blueprint coordinates.

Provides coordinate transformation between the camera/screen space
and the blueprint world space.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.vision.hand_detector import Landmark
    from core.blueprint.engine import ViewState


@dataclass
class ScreenPoint:
    """Point in screen/camera coordinates (0-1 normalized)."""

    x: float
    y: float

    def to_tuple(self) -> tuple[float, float]:
        """Convert to tuple."""
        return (self.x, self.y)


@dataclass
class BlueprintPoint:
    """Point in blueprint world coordinates."""

    x: float
    y: float
    z: float = 0.0

    def to_tuple(self) -> tuple[float, float, float]:
        """Convert to tuple."""
        return (self.x, self.y, self.z)

    def to_2d_tuple(self) -> tuple[float, float]:
        """Convert to 2D tuple."""
        return (self.x, self.y)


class SpatialMapper:
    """Maps between camera space and blueprint space.

    Handles the transformation of hand positions detected in camera
    coordinates to blueprint world coordinates, taking into account
    the current view state (pan, zoom, rotation).

    Usage:
        mapper = SpatialMapper()
        world_point = mapper.screen_to_blueprint(0.5, 0.5, view_state)
    """

    def __init__(
        self,
        screen_width: int = 640,
        screen_height: int = 480,
        flip_x: bool = True,  # Camera image is usually mirrored
        flip_y: bool = False,
    ) -> None:
        """Initialize spatial mapper.

        Args:
            screen_width: Camera/screen width in pixels.
            screen_height: Camera/screen height in pixels.
            flip_x: Whether to flip X axis (for mirrored camera).
            flip_y: Whether to flip Y axis.
        """
        self._screen_width = screen_width
        self._screen_height = screen_height
        self._flip_x = flip_x
        self._flip_y = flip_y

        # Smoothing for jitter reduction
        self._smoothing = 0.3
        self._last_x: float | None = None
        self._last_y: float | None = None

    @property
    def screen_size(self) -> tuple[int, int]:
        """Get screen size."""
        return (self._screen_width, self._screen_height)

    @screen_size.setter
    def screen_size(self, value: tuple[int, int]) -> None:
        """Set screen size."""
        self._screen_width, self._screen_height = value

    @property
    def smoothing(self) -> float:
        """Get smoothing factor (0 = none, 1 = maximum)."""
        return self._smoothing

    @smoothing.setter
    def smoothing(self, value: float) -> None:
        """Set smoothing factor."""
        self._smoothing = max(0.0, min(1.0, value))

    def screen_to_blueprint(
        self,
        screen_x: float,
        screen_y: float,
        view: "ViewState",
    ) -> BlueprintPoint:
        """Convert screen coordinates to blueprint world coordinates.

        Args:
            screen_x: X in screen space (0-1 normalized).
            screen_y: Y in screen space (0-1 normalized).
            view: Current view state.

        Returns:
            Point in blueprint world coordinates.
        """
        # Apply flipping
        if self._flip_x:
            screen_x = 1.0 - screen_x
        if self._flip_y:
            screen_y = 1.0 - screen_y

        # Apply smoothing
        if self._last_x is not None and self._smoothing > 0:
            screen_x = self._last_x + (screen_x - self._last_x) * (1 - self._smoothing)
            screen_y = self._last_y + (screen_y - self._last_y) * (1 - self._smoothing)

        self._last_x = screen_x
        self._last_y = screen_y

        # Convert to world coordinates using view state
        world_x, world_y = view.screen_to_world(screen_x, screen_y)

        return BlueprintPoint(x=world_x, y=world_y, z=0.0)

    def blueprint_to_screen(
        self,
        world_x: float,
        world_y: float,
        view: "ViewState",
    ) -> ScreenPoint:
        """Convert blueprint world coordinates to screen coordinates.

        Args:
            world_x: X in world space.
            world_y: Y in world space.
            view: Current view state.

        Returns:
            Point in screen coordinates (0-1 normalized).
        """
        screen_x, screen_y = view.world_to_screen(world_x, world_y)

        # Apply flipping (reverse)
        if self._flip_x:
            screen_x = 1.0 - screen_x
        if self._flip_y:
            screen_y = 1.0 - screen_y

        return ScreenPoint(x=screen_x, y=screen_y)

    def landmark_to_blueprint(
        self,
        landmark: "Landmark",
        view: "ViewState",
    ) -> BlueprintPoint:
        """Convert a hand landmark to blueprint coordinates.

        Args:
            landmark: Hand landmark from detector.
            view: Current view state.

        Returns:
            Point in blueprint world coordinates.
        """
        return self.screen_to_blueprint(landmark.x, landmark.y, view)

    def get_pointing_direction(
        self,
        finger_base: "Landmark",
        finger_tip: "Landmark",
    ) -> tuple[float, float]:
        """Get the pointing direction vector from finger landmarks.

        Args:
            finger_base: Base of finger (e.g., INDEX_FINGER_MCP).
            finger_tip: Tip of finger (e.g., INDEX_FINGER_TIP).

        Returns:
            Normalized direction vector (dx, dy).
        """
        dx = finger_tip.x - finger_base.x
        dy = finger_tip.y - finger_base.y

        # Apply flip
        if self._flip_x:
            dx = -dx
        if self._flip_y:
            dy = -dy

        # Normalize
        length = (dx * dx + dy * dy) ** 0.5
        if length > 0.001:
            dx /= length
            dy /= length

        return (dx, dy)

    def get_pinch_distance(
        self,
        thumb_tip: "Landmark",
        index_tip: "Landmark",
    ) -> float:
        """Get distance between thumb and index finger tips.

        Args:
            thumb_tip: Thumb tip landmark.
            index_tip: Index finger tip landmark.

        Returns:
            Distance in normalized coordinates.
        """
        dx = thumb_tip.x - index_tip.x
        dy = thumb_tip.y - index_tip.y
        return (dx * dx + dy * dy) ** 0.5

    def get_hand_velocity(
        self,
        palm_positions: list[tuple[float, float]],
        time_delta: float = 0.033,  # ~30fps
    ) -> tuple[float, float]:
        """Estimate hand velocity from position history.

        Args:
            palm_positions: Recent palm center positions.
            time_delta: Time between samples.

        Returns:
            Velocity vector (vx, vy) in normalized units per second.
        """
        if len(palm_positions) < 2:
            return (0.0, 0.0)

        # Use last two positions
        p1 = palm_positions[-2]
        p2 = palm_positions[-1]

        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]

        if self._flip_x:
            dx = -dx
        if self._flip_y:
            dy = -dy

        return (dx / time_delta, dy / time_delta)

    def reset_smoothing(self) -> None:
        """Reset smoothing state."""
        self._last_x = None
        self._last_y = None

    def get_cursor_position(
        self,
        index_tip: "Landmark",
        view: "ViewState",
    ) -> tuple[float, float]:
        """Get cursor position from index finger tip.

        Convenience method for common use case.

        Args:
            index_tip: Index finger tip landmark.
            view: Current view state.

        Returns:
            Blueprint world coordinates (x, y).
        """
        point = self.landmark_to_blueprint(index_tip, view)
        return point.to_2d_tuple()
