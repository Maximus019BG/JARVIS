"""Tool for rendering blueprints to display or file.

Provides blueprint rendering capabilities with various output formats.
"""

from __future__ import annotations

import base64
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from core.base_tool import BaseTool, ToolResult

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine


class BlueprintRenderTool(BaseTool):
    """Tool for rendering blueprints.

    Renders the current blueprint to display, framebuffer, or file.
    Supports PNG, SVG, and raw framebuffer output.
    """

    def __init__(self, engine: "BlueprintEngine | None" = None) -> None:
        """Initialize render tool.

        Args:
            engine: Blueprint engine instance.
        """
        self._engine = engine

    @property
    def name(self) -> str:
        return "blueprint_render"

    @property
    def description(self) -> str:
        return (
            "Render the current blueprint. "
            "Outputs: display (framebuffer), file (PNG/SVG), preview (base64)."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "output": {
                    "type": "string",
                    "enum": ["display", "file", "preview"],
                    "description": "Output target",
                },
                "format": {
                    "type": "string",
                    "enum": ["png", "svg"],
                    "description": "Output format (for file output)",
                },
                "path": {
                    "type": "string",
                    "description": "Output file path (for file output)",
                },
                "width": {
                    "type": "integer",
                    "description": "Output width in pixels",
                },
                "height": {
                    "type": "integer",
                    "description": "Output height in pixels",
                },
                "show_grid": {
                    "type": "boolean",
                    "description": "Show grid in output",
                },
                "view": {
                    "type": "string",
                    "enum": ["top", "front", "side", "isometric"],
                    "description": "View angle",
                },
            },
            "required": ["output"],
        }

    def set_engine(self, engine: "BlueprintEngine") -> None:
        """Set the blueprint engine reference."""
        self._engine = engine

    def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the render tool."""
        if not self._engine:
            return ToolResult.fail(
                "Blueprint engine not initialized.",
                error_type="engine_not_ready",
            )

        output = kwargs.get("output", "display")
        start_time = time.time()

        try:
            if output == "display":
                result = self._render_to_display(kwargs)
            elif output == "file":
                result = self._render_to_file(kwargs)
            elif output == "preview":
                result = self._render_preview(kwargs)
            else:
                return ToolResult.fail(
                    f"Unknown output: {output}",
                    error_type="validation_error",
                )

            duration_ms = int((time.time() - start_time) * 1000)
            return ToolResult.ok_result(
                result,
                tool=self.name,
                duration_ms=duration_ms,
            )

        except Exception as e:
            return ToolResult.fail(
                f"Render failed: {e!s}",
                error_type="render_error",
                error_details={"exception": type(e).__name__},
            )

    def _render_to_display(self, kwargs: dict[str, Any]) -> str:
        """Render to framebuffer display."""
        from core.blueprint.renderer import FramebufferRenderer

        # Get render configuration
        width = kwargs.get("width", 800)
        height = kwargs.get("height", 480)
        show_grid = kwargs.get("show_grid", True)

        # Set view if specified
        view = kwargs.get("view")
        if view:
            self._set_view(view)

        # Render
        frame = self._engine.render_view(width=width, height=height)

        # Output to framebuffer
        fb_renderer = FramebufferRenderer()
        if fb_renderer.available:
            fb_renderer.render(frame)
            return f"Rendered to framebuffer ({width}x{height})"
        else:
            return f"Rendered frame ({width}x{height}), framebuffer not available"

    def _render_to_file(self, kwargs: dict[str, Any]) -> str:
        """Render to file."""
        import cv2

        format_type = kwargs.get("format", "png")
        path = kwargs.get("path")
        width = kwargs.get("width", 1920)
        height = kwargs.get("height", 1080)

        if not path:
            # Generate default path
            timestamp = int(time.time())
            blueprint_name = "blueprint"
            if self._engine.current_blueprint:
                blueprint_name = self._engine.current_blueprint.metadata.get(
                    "name",
                    "blueprint",
                )
            path = f"{blueprint_name}_{timestamp}.{format_type}"

        # Ensure directory exists
        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Set view if specified
        view = kwargs.get("view")
        if view:
            self._set_view(view)

        if format_type == "png":
            frame = self._engine.render_view(width=width, height=height)
            cv2.imwrite(str(output_path), frame)
            return f"Saved PNG to {output_path} ({width}x{height})"

        elif format_type == "svg":
            svg_content = self._render_svg(width, height)
            output_path.write_text(svg_content)
            return f"Saved SVG to {output_path}"

        return f"Unknown format: {format_type}"

    def _render_preview(self, kwargs: dict[str, Any]) -> str:
        """Render preview as base64."""
        import cv2

        width = kwargs.get("width", 400)
        height = kwargs.get("height", 300)

        # Set view if specified
        view = kwargs.get("view")
        if view:
            self._set_view(view)

        frame = self._engine.render_view(width=width, height=height)

        # Encode as PNG
        _, buffer = cv2.imencode(".png", frame)
        b64 = base64.b64encode(buffer).decode("utf-8")

        return f"Preview rendered ({width}x{height}). Base64 length: {len(b64)}"

    def _set_view(self, view: str) -> None:
        """Set the view angle."""
        from core.blueprint.engine import ViewMode

        view_map = {
            "top": ViewMode.TOP_2D,
            "front": ViewMode.FRONT_2D,
            "side": ViewMode.SIDE_2D,
            "isometric": ViewMode.ISOMETRIC,
        }

        mode = view_map.get(view)
        if mode:
            self._engine.set_view_mode(mode)

    def _render_svg(self, width: int, height: int) -> str:
        """Render as SVG string."""
        # Basic SVG generation
        lines = [
            f'<?xml version="1.0" encoding="UTF-8"?>',
            f'<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg">',
            f'  <rect width="100%" height="100%" fill="#1a1a2e"/>',
        ]

        # Render components
        if self._engine.scene_graph:
            for node in self._engine.scene_graph.get_all_nodes():
                bounds = node.bounds
                if bounds:
                    # Simple rectangle representation
                    x = bounds.min_x * 10 + width / 2
                    y = bounds.min_y * 10 + height / 2
                    w = (bounds.max_x - bounds.min_x) * 10
                    h = (bounds.max_y - bounds.min_y) * 10
                    lines.append(
                        f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" '
                        f'fill="none" stroke="#00ff00" stroke-width="1"/>'
                    )

        lines.append("</svg>")
        return "\n".join(lines)
