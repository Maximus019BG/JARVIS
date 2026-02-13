"""Tool for exporting blueprints to various formats.

Provides export capabilities for STL, SVG, PNG, and other formats.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from core.base_tool import BaseTool, ToolResult

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine


class BlueprintExportTool(BaseTool):
    """Tool for exporting blueprints.

    Exports blueprints to STL (3D printing), SVG (vector graphics),
    PNG (raster), and JSON (data).
    """

    def __init__(self, engine: "BlueprintEngine | None" = None) -> None:
        """Initialize export tool.

        Args:
            engine: Blueprint engine instance.
        """
        self._engine = engine

    @property
    def name(self) -> str:
        return "blueprint_export"

    @property
    def description(self) -> str:
        return (
            "Export blueprint to various formats. "
            "Formats: stl, svg, png, json, dxf, gcode."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "format": {
                    "type": "string",
                    "enum": ["stl", "svg", "png", "json", "dxf", "gcode"],
                    "description": "Export format",
                },
                "path": {
                    "type": "string",
                    "description": "Output file path",
                },
                "component_id": {
                    "type": "string",
                    "description": "Specific component to export (or 'all')",
                },
                "scale": {
                    "type": "number",
                    "description": "Scale factor for export",
                },
                "unit": {
                    "type": "string",
                    "enum": ["mm", "cm", "m", "in"],
                    "description": "Output unit",
                },
                "resolution": {
                    "type": "integer",
                    "description": "Resolution for raster export (DPI)",
                },
                "include_metadata": {
                    "type": "boolean",
                    "description": "Include metadata in export",
                },
            },
            "required": ["format"],
        }

    def set_engine(self, engine: "BlueprintEngine") -> None:
        """Set the blueprint engine reference."""
        self._engine = engine

    def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the export tool."""
        if not self._engine:
            return ToolResult.fail(
                "Blueprint engine not initialized.",
                error_type="engine_not_ready",
            )

        if not self._engine.current_blueprint:
            return ToolResult.fail(
                "No blueprint loaded.",
                error_type="no_blueprint",
            )

        export_format = kwargs.get("format", "json")
        start_time = time.time()

        try:
            handlers = {
                "stl": self._export_stl,
                "svg": self._export_svg,
                "png": self._export_png,
                "json": self._export_json,
                "dxf": self._export_dxf,
                "gcode": self._export_gcode,
            }

            handler = handlers.get(export_format)
            if not handler:
                return ToolResult.fail(
                    f"Unknown format: {export_format}",
                    error_type="validation_error",
                )

            result = handler(kwargs)
            duration_ms = int((time.time() - start_time) * 1000)

            return ToolResult.ok_result(
                result,
                tool=self.name,
                duration_ms=duration_ms,
            )

        except Exception as e:
            return ToolResult.fail(
                f"Export failed: {e!s}",
                error_type="export_error",
                error_details={"exception": type(e).__name__},
            )

    def _get_output_path(self, kwargs: dict[str, Any], extension: str) -> Path:
        """Get output path for export."""
        path = kwargs.get("path")

        if path:
            output_path = Path(path)
        else:
            # Generate default path
            timestamp = int(time.time())
            name = self._engine.current_blueprint.metadata.get("name", "blueprint")
            output_path = Path(f"exports/{name}_{timestamp}.{extension}")

        # Ensure directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        return output_path

    def _export_stl(self, kwargs: dict[str, Any]) -> str:
        """Export to STL format for 3D printing."""
        output_path = self._get_output_path(kwargs, "stl")
        scale = kwargs.get("scale", 1.0)
        unit = kwargs.get("unit", "mm")

        # STL generation (basic ASCII format)
        lines = ["solid blueprint"]

        # Generate triangles from components
        if self._engine.scene_graph:
            for node in self._engine.scene_graph.get_all_nodes():
                bounds = node.bounds
                if bounds:
                    # Generate a simple box for each component
                    triangles = self._bounds_to_triangles(
                        bounds.min_x * scale,
                        bounds.min_y * scale,
                        bounds.min_z * scale if hasattr(bounds, "min_z") else 0,
                        bounds.max_x * scale,
                        bounds.max_y * scale,
                        bounds.max_z * scale if hasattr(bounds, "max_z") else 10,
                    )
                    for tri in triangles:
                        lines.extend(self._triangle_to_stl(tri))

        lines.append("endsolid blueprint")

        output_path.write_text("\n".join(lines))
        return f"Exported STL to {output_path} (unit: {unit}, scale: {scale})"

    def _bounds_to_triangles(
        self,
        min_x: float,
        min_y: float,
        min_z: float,
        max_x: float,
        max_y: float,
        max_z: float,
    ) -> list[tuple[tuple[float, float, float], ...]]:
        """Convert bounds to triangles for STL."""
        # 8 vertices of the box
        v = [
            (min_x, min_y, min_z),  # 0
            (max_x, min_y, min_z),  # 1
            (max_x, max_y, min_z),  # 2
            (min_x, max_y, min_z),  # 3
            (min_x, min_y, max_z),  # 4
            (max_x, min_y, max_z),  # 5
            (max_x, max_y, max_z),  # 6
            (min_x, max_y, max_z),  # 7
        ]

        # 12 triangles (2 per face)
        faces = [
            # Bottom
            (v[0], v[2], v[1]),
            (v[0], v[3], v[2]),
            # Top
            (v[4], v[5], v[6]),
            (v[4], v[6], v[7]),
            # Front
            (v[0], v[1], v[5]),
            (v[0], v[5], v[4]),
            # Back
            (v[2], v[3], v[7]),
            (v[2], v[7], v[6]),
            # Left
            (v[0], v[4], v[7]),
            (v[0], v[7], v[3]),
            # Right
            (v[1], v[2], v[6]),
            (v[1], v[6], v[5]),
        ]

        return faces

    def _triangle_to_stl(
        self, tri: tuple[tuple[float, float, float], ...]
    ) -> list[str]:
        """Convert triangle to STL format lines."""
        # Calculate normal (simplified)
        v0, v1, v2 = tri
        ux, uy, uz = v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
        vx, vy, vz = v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        length = (nx * nx + ny * ny + nz * nz) ** 0.5
        if length > 0:
            nx, ny, nz = nx / length, ny / length, nz / length
        else:
            nx, ny, nz = 0, 0, 1

        return [
            f"  facet normal {nx:.6f} {ny:.6f} {nz:.6f}",
            "    outer loop",
            f"      vertex {v0[0]:.6f} {v0[1]:.6f} {v0[2]:.6f}",
            f"      vertex {v1[0]:.6f} {v1[1]:.6f} {v1[2]:.6f}",
            f"      vertex {v2[0]:.6f} {v2[1]:.6f} {v2[2]:.6f}",
            "    endloop",
            "  endfacet",
        ]

    def _export_svg(self, kwargs: dict[str, Any]) -> str:
        """Export to SVG format."""
        output_path = self._get_output_path(kwargs, "svg")
        scale = kwargs.get("scale", 10.0)  # Default scale for visibility
        include_metadata = kwargs.get("include_metadata", True)

        width = 800
        height = 600

        lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            f'<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg">',
        ]

        # Add metadata if requested
        if include_metadata:
            bp = self._engine.current_blueprint
            lines.append("  <metadata>")
            lines.append(f"    <title>{bp.metadata.get('name', 'Blueprint')}</title>")
            lines.append(f"    <desc>{bp.metadata.get('description', '')}</desc>")
            lines.append("  </metadata>")

        # Background
        lines.append('  <rect width="100%" height="100%" fill="#1a1a2e"/>')

        # Offset to center
        offset_x = width / 2
        offset_y = height / 2

        # Render components
        if self._engine.scene_graph:
            for node in self._engine.scene_graph.get_all_nodes():
                bounds = node.bounds
                if bounds:
                    x = bounds.min_x * scale + offset_x
                    y = bounds.min_y * scale + offset_y
                    w = (bounds.max_x - bounds.min_x) * scale
                    h = (bounds.max_y - bounds.min_y) * scale

                    lines.append(
                        f'  <rect x="{x:.2f}" y="{y:.2f}" '
                        f'width="{w:.2f}" height="{h:.2f}" '
                        f'fill="none" stroke="#00ff00" stroke-width="1">'
                    )
                    lines.append(f"    <title>{node.name}</title>")
                    lines.append("  </rect>")

        lines.append("</svg>")

        output_path.write_text("\n".join(lines))
        return f"Exported SVG to {output_path}"

    def _export_png(self, kwargs: dict[str, Any]) -> str:
        """Export to PNG format."""
        import cv2

        output_path = self._get_output_path(kwargs, "png")
        resolution = kwargs.get("resolution", 150)

        # Calculate size based on resolution
        width = int(8 * resolution)  # 8 inches at given DPI
        height = int(6 * resolution)

        # Render frame
        frame = self._engine.render_view(width=width, height=height)

        cv2.imwrite(str(output_path), frame)
        return f"Exported PNG to {output_path} ({width}x{height} @ {resolution} DPI)"

    def _export_json(self, kwargs: dict[str, Any]) -> str:
        """Export to JSON format."""
        output_path = self._get_output_path(kwargs, "json")
        include_metadata = kwargs.get("include_metadata", True)

        bp = self._engine.current_blueprint
        data = bp.model_dump() if hasattr(bp, "model_dump") else bp.dict()

        if not include_metadata:
            data.pop("metadata", None)

        output_path.write_text(json.dumps(data, indent=2, default=str))
        return f"Exported JSON to {output_path}"

    def _export_dxf(self, kwargs: dict[str, Any]) -> str:
        """Export to DXF format (AutoCAD)."""
        output_path = self._get_output_path(kwargs, "dxf")
        scale = kwargs.get("scale", 1.0)

        # Basic DXF structure
        lines = [
            "0",
            "SECTION",
            "2",
            "ENTITIES",
        ]

        # Export components as rectangles
        if self._engine.scene_graph:
            for node in self._engine.scene_graph.get_all_nodes():
                bounds = node.bounds
                if bounds:
                    # LINE entities for rectangle
                    corners = [
                        (bounds.min_x * scale, bounds.min_y * scale),
                        (bounds.max_x * scale, bounds.min_y * scale),
                        (bounds.max_x * scale, bounds.max_y * scale),
                        (bounds.min_x * scale, bounds.max_y * scale),
                    ]

                    for i in range(4):
                        x1, y1 = corners[i]
                        x2, y2 = corners[(i + 1) % 4]
                        lines.extend(
                            [
                                "0",
                                "LINE",
                                "8",
                                "0",  # Layer
                                "10",
                                f"{x1:.6f}",
                                "20",
                                f"{y1:.6f}",
                                "30",
                                "0.0",
                                "11",
                                f"{x2:.6f}",
                                "21",
                                f"{y2:.6f}",
                                "31",
                                "0.0",
                            ]
                        )

        lines.extend(
            [
                "0",
                "ENDSEC",
                "0",
                "EOF",
            ]
        )

        output_path.write_text("\n".join(lines))
        return f"Exported DXF to {output_path}"

    def _export_gcode(self, kwargs: dict[str, Any]) -> str:
        """Export to G-code for CNC/3D printing."""
        output_path = self._get_output_path(kwargs, "gcode")
        scale = kwargs.get("scale", 1.0)

        lines = [
            "; G-code generated by JARVIS Blueprint Engine",
            f"; Blueprint: {self._engine.current_blueprint.metadata.get('name', 'Unknown')}",
            "",
            "G21 ; Set units to mm",
            "G90 ; Absolute positioning",
            "G28 ; Home all axes",
            "G1 Z5 F300 ; Lift",
            "",
        ]

        # Generate simple outline toolpath
        if self._engine.scene_graph:
            for node in self._engine.scene_graph.get_all_nodes():
                bounds = node.bounds
                if bounds:
                    lines.append(f"; Component: {node.name}")

                    # Move to start
                    x1, y1 = bounds.min_x * scale, bounds.min_y * scale
                    x2, y2 = bounds.max_x * scale, bounds.max_y * scale

                    lines.append(f"G0 X{x1:.3f} Y{y1:.3f} ; Move to start")
                    lines.append("G1 Z0 F100 ; Lower")
                    lines.append(f"G1 X{x2:.3f} Y{y1:.3f} F500 ; Bottom edge")
                    lines.append(f"G1 X{x2:.3f} Y{y2:.3f} ; Right edge")
                    lines.append(f"G1 X{x1:.3f} Y{y2:.3f} ; Top edge")
                    lines.append(f"G1 X{x1:.3f} Y{y1:.3f} ; Left edge")
                    lines.append("G1 Z5 F300 ; Lift")
                    lines.append("")

        lines.extend(
            [
                "G28 ; Home",
                "M84 ; Disable motors",
            ]
        )

        output_path.write_text("\n".join(lines))
        return f"Exported G-code to {output_path}"
