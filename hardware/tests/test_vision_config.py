"""Tests for vision configuration."""

import pytest
import os

from core.vision.vision_config import VisionConfig


class TestVisionConfig:
    """Tests for VisionConfig class."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = VisionConfig()

        assert config.enabled is False
        assert config.camera_width == 640
        assert config.camera_height == 480
        assert config.camera_fps == 30
        assert config.camera_rotation == 0
        assert config.max_hands == 2
        assert config.detection_confidence == 0.5
        assert config.tracking_confidence == 0.5
        assert config.gesture_cooldown_ms == 300

    def test_env_prefix(self) -> None:
        """Test VISION_ prefix is used for env vars."""
        # Set env var
        os.environ["VISION_ENABLED"] = "true"
        os.environ["VISION_CAMERA_WIDTH"] = "1280"

        try:
            config = VisionConfig()
            assert config.enabled is True
            assert config.camera_width == 1280
        finally:
            # Clean up
            del os.environ["VISION_ENABLED"]
            del os.environ["VISION_CAMERA_WIDTH"]

    def test_camera_width_bounds(self) -> None:
        """Test camera width has valid bounds."""
        # Test minimum
        config = VisionConfig(camera_width=320)
        assert config.camera_width == 320

        # Test maximum
        config = VisionConfig(camera_width=1920)
        assert config.camera_width == 1920

    def test_camera_fps_bounds(self) -> None:
        """Test camera FPS has valid bounds."""
        config = VisionConfig(camera_fps=15)
        assert config.camera_fps == 15

        config = VisionConfig(camera_fps=60)
        assert config.camera_fps == 60

    def test_detection_confidence_bounds(self) -> None:
        """Test detection confidence has valid bounds."""
        config = VisionConfig(detection_confidence=0.1)
        assert config.detection_confidence == 0.1

        config = VisionConfig(detection_confidence=1.0)
        assert config.detection_confidence == 1.0

    def test_validate_rotation_valid(self) -> None:
        """Test validate_rotation accepts valid values."""
        for rotation in [0, 90, 180, 270]:
            config = VisionConfig(camera_rotation=rotation)
            config.validate_rotation()  # Should not raise

    def test_validate_rotation_invalid(self) -> None:
        """Test validate_rotation rejects invalid values."""
        config = VisionConfig(camera_rotation=45)

        with pytest.raises(ValueError, match="Invalid camera rotation"):
            config.validate_rotation()

    def test_max_hands_bounds(self) -> None:
        """Test max_hands has valid bounds."""
        config = VisionConfig(max_hands=1)
        assert config.max_hands == 1

        config = VisionConfig(max_hands=4)
        assert config.max_hands == 4

    def test_gesture_cooldown_bounds(self) -> None:
        """Test gesture cooldown has valid bounds."""
        config = VisionConfig(gesture_cooldown_ms=100)
        assert config.gesture_cooldown_ms == 100

        config = VisionConfig(gesture_cooldown_ms=2000)
        assert config.gesture_cooldown_ms == 2000
