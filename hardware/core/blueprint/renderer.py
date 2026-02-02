"""Blueprint renderer for framebuffer/display output.

Provides 2D rendering of blueprints to numpy arrays or framebuffer.
Designed for Raspberry Pi with headless operation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

import numpy as np
from numpy.typing import NDArray

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine, ViewState
    from core.blueprint.scene_graph import SceneGraph, SceneNode, BoundingBox


class RenderStyle(str, Enum):
    """Rendering style presets."""

    WIREFRAME = "wireframe"
    SOLID = "solid"
    SHADED = "shaded"
    TECHNICAL = "technical"


@dataclass
class RenderConfig:
    """Configuration for rendering."""

    width: int = 800
    height: int = 600
    background_color: tuple[int, int, int] = (32, 32, 32)
    grid_color: tuple[int, int, int] = (64, 64, 64)
    component_color: tuple[int, int, int] = (100, 150, 200)
    selection_color: tuple[int, int, int] = (255, 200, 50)
    line_width: int = 2
    selection_line_width: int = 3
    show_grid: bool = True
    show_bounds: bool = False
    show_labels: bool = True
    style: RenderStyle = RenderStyle.SOLID
    antialiased: bool = True


@dataclass
class RenderStats:
    """Statistics from a render pass."""

    frame_time_ms: float = 0.0
    nodes_rendered: int = 0
    primitives_drawn: int = 0


class BlueprintRenderer:
    """Renders blueprint to numpy array / framebuffer.

    Provides 2D top-down rendering of blueprints with support for
    selection highlighting, grid overlay, and various styles.

    Usage:
        renderer = BlueprintRenderer(config)
        frame = renderer.render(engine)
        # frame is numpy array (H, W, 3) uint8 BGR
    """

    def __init__(self, config: RenderConfig | None = None) -> None:
        """Initialize renderer.

        Args:
            config: Rendering configuration.
        """
        self._config = config or RenderConfig()
        self._stats = RenderStats()
        self._cv2_available = self._check_cv2()

    def _check_cv2(self) -> bool:
        """Check if OpenCV is available for rendering."""
        try:
            import cv2
            return True
        except ImportError:
            return False

    @property
    def config(self) -> RenderConfig:
        """Get render configuration."""
        return self._config

    @config.setter
    def config(self, value: RenderConfig) -> None:
        """Set render configuration."""
        self._config = value

    @property
    def stats(self) -> RenderStats:
        """Get stats from last render."""
        return self._stats

    def render(self, engine: BlueprintEngine) -> NDArray[np.uint8]:
        """Render the blueprint to a numpy array.

        Args:
            engine: Blueprint engine to render.

        Returns:
            BGR image as numpy array (H, W, 3).
        """
        import time
        start_time = time.perf_counter()

        # Create blank canvas
        frame = self._create_canvas()

        # Draw grid if enabled
        if self._config.show_grid and engine.state.grid_enabled:
            self._draw_grid(frame, engine.view, engine.state.grid_size)

        # Draw components
        nodes_rendered = 0
        primitives = 0

        for node in engine.scene.get_visible_nodes():
            if node.id == "root":
                continue

            is_selected = engine.selection.is_selected(node.id)
            self._draw_node(frame, node, engine.view, is_selected)
            nodes_rendered += 1
            primitives += 1

        # Draw selection bounds if multiple selected
        if engine.selection.count > 1:
            bounds = engine.selection.get_selection_bounds()
            if bounds:
                self._draw_selection_bounds(frame, bounds, engine.view)
                primitives += 1

        # Update stats
        end_time = time.perf_counter()
        self._stats = RenderStats(
            frame_time_ms=(end_time - start_time) * 1000,
            nodes_rendered=nodes_rendered,
            primitives_drawn=primitives,
        )

        return frame

    def render_to_file(
        self, engine: BlueprintEngine, path: str, format: str = "png"
    ) -> bool:
        """Render blueprint to image file.

        Args:
            engine: Blueprint engine to render.
            path: Output file path.
            format: Image format (png, jpg, bmp).

        Returns:
            True if saved successfully.
        """
        if not self._cv2_available:
            return False

        import cv2
        frame = self.render(engine)
        return cv2.imwrite(path, frame)

    def _create_canvas(self) -> NDArray[np.uint8]:
        """Create blank canvas with background color."""
        frame = np.zeros(
            (self._config.height, self._config.width, 3),
            dtype=np.uint8
        )
        frame[:] = self._config.background_color
        return frame

    def _draw_grid(
        self,
        frame: NDArray[np.uint8],
        view: ViewState,
        grid_size: float,
    ) -> None:
        """Draw grid overlay."""
        if not self._cv2_available:
            return

        import cv2

        h, w = frame.shape[:2]
        color = self._config.grid_color

        # Calculate grid lines in screen space
        zoom = view.zoom
        scaled_grid = grid_size * zoom

        if scaled_grid < 5:  # Too small to draw
            return

        # Vertical lines
        offset_x = (view.pan_x * zoom + w / 2) % scaled_grid
        x = offset_x
        while x < w:
            cv2.line(frame, (int(x), 0), (int(x), h), color, 1)
            x += scaled_grid

        # Horizontal lines
        offset_y = (view.pan_y * zoom + h / 2) % scaled_grid
        y = offset_y
        while y < h:
            cv2.line(frame, (0, int(y)), (w, int(y)), color, 1)
            y += scaled_grid

    def _draw_node(
        self,
        frame: NDArray[np.uint8],
        node: SceneNode,
        view: ViewState,
        selected: bool,
    ) -> None:
        """Draw a scene node."""
        if not self._cv2_available:
            return

        import cv2

        h, w = frame.shape[:2]

        # Get world bounds
        bounds = node.get_world_bounds()

        # Convert to screen coordinates
        min_sx, min_sy = self._world_to_screen(
            bounds.min_x, bounds.min_y, view, w, h
        )
        max_sx, max_sy = self._world_to_screen(
            bounds.max_x, bounds.max_y, view, w, h
        )

        # Ensure proper ordering
        x1, x2 = min(min_sx, max_sx), max(min_sx, max_sx)
        y1, y2 = min(min_sy, max_sy), max(min_sy, max_sy)

        # Skip if off-screen
        if x2 < 0 or x1 > w or y2 < 0 or y1 > h:
            return

        # Choose color and line width
        if selected:
            color = self._config.selection_color
            thickness = self._config.selection_line_width
        else:
            color = self._config.component_color
            thickness = self._config.line_width

        pt1 = (int(x1), int(y1))
        pt2 = (int(x2), int(y2))

        # Draw based on style
        if self._config.style == RenderStyle.WIREFRAME:
            cv2.rectangle(frame, pt1, pt2, color, thickness)
        elif self._config.style == RenderStyle.SOLID:
            cv2.rectangle(frame, pt1, pt2, color, -1)  # Filled
            cv2.rectangle(frame, pt1, pt2, (200, 200, 200), 1)  # Border
        else:
            cv2.rectangle(frame, pt1, pt2, color, thickness)

        # Draw label if enabled
        if self._config.show_labels and node.name:
            label_x = int((x1 + x2) / 2)
            label_y = int((y1 + y2) / 2)
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.4
            cv2.putText(
                frame, node.name, (label_x, label_y),
                font, font_scale, (255, 255, 255), 1, cv2.LINE_AA
            )

    def _draw_selection_bounds(
        self,
        frame: NDArray[np.uint8],
        bounds: BoundingBox,
        view: ViewState,
    ) -> None:
        """Draw dashed selection bounds rectangle."""
        if not self._cv2_available:
            return

        import cv2

        h, w = frame.shape[:2]

        min_sx, min_sy = self._world_to_screen(
            bounds.min_x, bounds.min_y, view, w, h
        )
        max_sx, max_sy = self._world_to_screen(
            bounds.max_x, bounds.max_y, view, w, h
        )

        x1, x2 = min(min_sx, max_sx), max(min_sx, max_sx)
        y1, y2 = min(min_sy, max_sy), max(min_sy, max_sy)

        # Draw dashed rectangle
        color = self._config.selection_color
        self._draw_dashed_rect(frame, int(x1), int(y1), int(x2), int(y2), color)

    def _draw_dashed_rect(
        self,
        frame: NDArray[np.uint8],
        x1: int, y1: int, x2: int, y2: int,
        color: tuple[int, int, int],
        dash_length: int = 10,
    ) -> None:
        """Draw a dashed rectangle."""
        if not self._cv2_available:
            return

        import cv2

        # Top edge
        for x in range(x1, x2, dash_length * 2):
            end_x = min(x + dash_length, x2)
            cv2.line(frame, (x, y1), (end_x, y1), color, 1)

        # Bottom edge
        for x in range(x1, x2, dash_length * 2):
            end_x = min(x + dash_length, x2)
            cv2.line(frame, (x, y2), (end_x, y2), color, 1)

        # Left edge
        for y in range(y1, y2, dash_length * 2):
            end_y = min(y + dash_length, y2)
            cv2.line(frame, (x1, y), (x1, end_y), color, 1)

        # Right edge
        for y in range(y1, y2, dash_length * 2):
            end_y = min(y + dash_length, y2)
            cv2.line(frame, (x2, y), (x2, end_y), color, 1)

    def _world_to_screen(
        self,
        wx: float, wy: float,
        view: ViewState,
        screen_w: int, screen_h: int,
    ) -> tuple[float, float]:
        """Convert world coordinates to screen pixels."""
        sx = (wx + view.pan_x) * view.zoom + screen_w / 2
        sy = (-wy - view.pan_y) * view.zoom + screen_h / 2  # Y flipped
        return sx, sy


class FramebufferRenderer(BlueprintRenderer):
    """Renderer that outputs directly to Linux framebuffer.

    For headless Raspberry Pi operation.
    """

    def __init__(
        self,
        config: RenderConfig | None = None,
        fb_device: str = "/dev/fb0",
    ) -> None:
        """Initialize framebuffer renderer.

        Args:
            config: Rendering configuration.
            fb_device: Path to framebuffer device.
        """
        super().__init__(config)
        self._fb_device = fb_device
        self._fb_available = self._check_framebuffer()

    def _check_framebuffer(self) -> bool:
        """Check if framebuffer is available."""
        from pathlib import Path
        return Path(self._fb_device).exists()

    @property
    def is_available(self) -> bool:
        """Check if framebuffer rendering is available."""
        return self._fb_available

    def render_to_framebuffer(self, engine: BlueprintEngine) -> bool:
        """Render directly to framebuffer.

        Args:
            engine: Blueprint engine to render.

        Returns:
            True if rendered successfully.
        """
        if not self._fb_available:
            return False

        try:
            frame = self.render(engine)

            # Convert BGR to RGB and then to framebuffer format
            # Most framebuffers are BGRA or RGB565
            h, w = frame.shape[:2]

            # Try BGRA32
            with open(self._fb_device, "wb") as fb:
                # Add alpha channel
                bgra = np.zeros((h, w, 4), dtype=np.uint8)
                bgra[:, :, :3] = frame
                bgra[:, :, 3] = 255
                fb.write(bgra.tobytes())

            return True

        except Exception:
            return False
