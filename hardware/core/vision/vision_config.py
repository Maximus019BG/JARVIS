"""Vision-specific configuration using pydantic-settings.

Supports environment variable configuration with VISION_ prefix.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class VisionConfig(BaseSettings):
    """Vision subsystem configuration.

    Environment variables (all prefixed with VISION_):
        VISION_ENABLED: Enable gesture control
        VISION_CAMERA_WIDTH: Camera resolution width
        VISION_CAMERA_HEIGHT: Camera resolution height
        VISION_CAMERA_FPS: Target frames per second
        VISION_CAMERA_ROTATION: Camera rotation (0, 90, 180, 270)
        VISION_MAX_HANDS: Maximum hands to detect
        VISION_DETECTION_CONFIDENCE: Min detection confidence
        VISION_TRACKING_CONFIDENCE: Min tracking confidence
        VISION_GESTURE_COOLDOWN_MS: Cooldown between same gesture
    """

    model_config = SettingsConfigDict(
        env_prefix="VISION_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Master enable switch
    enabled: bool = Field(
        default=False,
        description="Enable gesture control",
    )

    # Camera settings
    camera_width: int = Field(
        default=640,
        ge=320,
        le=1920,
        description="Camera resolution width",
    )
    camera_height: int = Field(
        default=480,
        ge=240,
        le=1080,
        description="Camera resolution height",
    )
    camera_fps: int = Field(
        default=30,
        ge=15,
        le=60,
        description="Target frames per second",
    )
    camera_rotation: int = Field(
        default=0,
        description="Camera rotation (0, 90, 180, 270)",
    )
    camera_device: int = Field(
        default=0,
        ge=0,
        description="Camera device ID for OpenCV fallback",
    )

    # Hand detection settings
    max_hands: int = Field(
        default=2,
        ge=1,
        le=4,
        description="Maximum number of hands to detect",
    )
    detection_confidence: float = Field(
        default=0.5,
        ge=0.1,
        le=1.0,
        description="Minimum detection confidence threshold",
    )
    tracking_confidence: float = Field(
        default=0.5,
        ge=0.1,
        le=1.0,
        description="Minimum tracking confidence threshold",
    )
    model_complexity: int = Field(
        default=0,
        ge=0,
        le=1,
        description="MediaPipe model complexity (0=Lite, 1=Full)",
    )

    # Gesture settings
    gesture_cooldown_ms: int = Field(
        default=300,
        ge=100,
        le=2000,
        description="Minimum time between same gesture emissions (ms)",
    )

    def validate_rotation(self) -> None:
        """Validate camera rotation is a valid value."""
        valid_rotations = {0, 90, 180, 270}
        if self.camera_rotation not in valid_rotations:
            raise ValueError(
                f"Invalid camera rotation: {self.camera_rotation}. "
                f"Must be one of {valid_rotations}"
            )
