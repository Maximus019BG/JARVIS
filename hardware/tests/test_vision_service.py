"""Tests for core.vision – VisionService, VisionServiceConfig."""

from __future__ import annotations

from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from core.vision import VisionService, VisionServiceConfig
from core.vision.camera_capture import CameraConfig
from core.vision.hand_detector import HandDetectorConfig
from core.vision.gesture_recognizer import GestureType


# ---------------------------------------------------------------------------
# VisionServiceConfig
# ---------------------------------------------------------------------------

class TestVisionServiceConfig:
    def test_defaults(self):
        cfg = VisionServiceConfig()
        assert cfg.camera is None
        assert cfg.hand_detector is None
        assert cfg.gesture_cooldown_ms == 300

    def test_from_vision_config(self):
        from core.vision.vision_config import VisionConfig
        vc = VisionConfig()
        cfg = VisionServiceConfig.from_vision_config(vc)
        assert isinstance(cfg.camera, CameraConfig)
        assert isinstance(cfg.hand_detector, HandDetectorConfig)
        assert cfg.gesture_cooldown_ms == vc.gesture_cooldown_ms


# ---------------------------------------------------------------------------
# VisionService init
# ---------------------------------------------------------------------------

class TestVisionServiceInit:
    def test_default_init(self):
        with patch("core.vision.CameraCapture"):
            with patch("core.vision.HandDetector"):
                svc = VisionService()
        assert svc.is_running is False

    def test_events_property(self):
        with patch("core.vision.CameraCapture"):
            with patch("core.vision.HandDetector"):
                svc = VisionService()
        assert svc.events is not None

    def test_custom_config(self):
        cfg = VisionServiceConfig(
            camera=CameraConfig(width=320, height=240),
            gesture_cooldown_ms=500,
        )
        with patch("core.vision.CameraCapture"):
            with patch("core.vision.HandDetector"):
                svc = VisionService(config=cfg)
        assert svc._config.gesture_cooldown_ms == 500


# ---------------------------------------------------------------------------
# stop
# ---------------------------------------------------------------------------

class TestVisionServiceStop:
    def test_stop(self):
        with patch("core.vision.CameraCapture"):
            with patch("core.vision.HandDetector") as MockHD:
                svc = VisionService()
        svc.stop()
        assert svc.is_running is False
        svc._detector.close.assert_called_once()


# ---------------------------------------------------------------------------
# run_once
# ---------------------------------------------------------------------------

class TestRunOnce:
    def test_run_once_no_detections(self):
        import asyncio
        with patch("core.vision.CameraCapture"):
            with patch("core.vision.HandDetector") as MockHD:
                svc = VisionService()
        svc._detector.detect.return_value = []
        results = asyncio.run(svc.run_once(MagicMock()))
        assert results == []

    def test_run_once_with_valid_gesture(self):
        import asyncio
        with patch("core.vision.CameraCapture"):
            with patch("core.vision.HandDetector"):
                svc = VisionService()

        detection = MagicMock()
        svc._detector.detect.return_value = [detection]

        gesture_result = MagicMock()
        gesture_result.is_valid = True
        gesture_result.gesture = GestureType.THUMBS_UP
        svc._recognizer = MagicMock()
        svc._recognizer.recognize.return_value = gesture_result

        results = asyncio.run(svc.run_once(MagicMock()))
        assert len(results) == 1
        assert results[0].gesture == GestureType.THUMBS_UP

    def test_run_once_invalid_gesture_filtered(self):
        import asyncio
        with patch("core.vision.CameraCapture"):
            with patch("core.vision.HandDetector"):
                svc = VisionService()

        detection = MagicMock()
        svc._detector.detect.return_value = [detection]

        gesture_result = MagicMock()
        gesture_result.is_valid = False
        svc._recognizer = MagicMock()
        svc._recognizer.recognize.return_value = gesture_result

        results = asyncio.run(svc.run_once(MagicMock()))
        assert results == []
