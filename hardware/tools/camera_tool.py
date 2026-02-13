"""Tool for camera status and control."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from core.base_tool import BaseTool, ToolResult

if TYPE_CHECKING:
    from core.vision import VisionService


class CameraTool(BaseTool):
    """Tool for camera status and diagnostics.

    Provides information about camera status and basic controls.
    """

    def __init__(self, vision_service: "VisionService | None" = None) -> None:
        self._vision_service = vision_service

    @property
    def name(self) -> str:
        return "camera"

    @property
    def description(self) -> str:
        return (
            "Check camera status and diagnostics. "
            "Actions: status, info"
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["status", "info"],
                    "description": "Action to perform",
                },
            },
            "required": ["action"],
        }

    def set_vision_service(self, service: "VisionService") -> None:
        """Set the vision service reference."""
        self._vision_service = service

    def execute(self, **kwargs: Any) -> ToolResult:
        """Execute the camera tool."""
        action = kwargs.get("action", "status")

        if action == "status":
            return self._status()

        if action == "info":
            return self._info()

        return ToolResult.fail(
            f"Unknown action: {action}",
            error_type="validation_error",
        )

    def _status(self) -> ToolResult:
        """Get camera status."""
        if not self._vision_service:
            return ToolResult.ok_result(
                "Camera status: Vision service not initialized.\n"
                "Enable vision with VISION_ENABLED=true in environment."
            )

        is_running = self._vision_service.is_running
        status = "active" if is_running else "stopped"

        return ToolResult.ok_result(
            f"Camera status: {status}\n"
            f"Vision service: {'running' if is_running else 'not running'}"
        )

    def _info(self) -> ToolResult:
        """Get camera information."""
        info_lines = [
            "Camera Information:",
            "",
            "Supported backends:",
            "  - PiCamera2 (Raspberry Pi)",
            "  - OpenCV VideoCapture (fallback)",
            "",
            "Configuration (via environment):",
            "  VISION_CAMERA_WIDTH: Resolution width (default: 640)",
            "  VISION_CAMERA_HEIGHT: Resolution height (default: 480)",
            "  VISION_CAMERA_FPS: Target FPS (default: 30)",
            "  VISION_CAMERA_ROTATION: Rotation degrees (0/90/180/270)",
            "",
            "For Raspberry Pi with IMX500:",
            "  - Ensure camera is enabled in raspi-config",
            "  - Check connection with: libcamera-hello --list-cameras",
        ]

        return ToolResult.ok_result("\n".join(info_lines))
