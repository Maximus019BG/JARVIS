"""Vision module - hand detection and gesture recognition.

This module provides real-time hand detection and gesture recognition
using MediaPipe, designed for Raspberry Pi with IMX500 camera.

Usage:
    from core.vision import VisionService, GestureType, GestureResult

    service = VisionService()
    service.events.on(GestureType.THUMBS_UP, my_handler)
    await service.run()
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app_logging.logger import get_logger

from core.vision.camera_capture import CameraCapture, CameraConfig
from core.vision.hand_detector import HandDetector, HandDetectorConfig, HandDetection
from core.vision.gesture_recognizer import GestureRecognizer, GestureType, GestureResult
from core.vision.gesture_events import GestureEventEmitter
from core.vision.vision_config import VisionConfig

if TYPE_CHECKING:
    pass

logger = get_logger(__name__)

__all__ = [
    "VisionService",
    "VisionServiceConfig",
    "GestureType",
    "GestureResult",
    "CameraConfig",
    "HandDetection",
    "GestureEventEmitter",
]


@dataclass
class VisionServiceConfig:
    """Configuration for the vision service."""

    camera: CameraConfig | None = None
    hand_detector: HandDetectorConfig | None = None
    gesture_cooldown_ms: int = 300  # Min time between same gesture emissions

    @classmethod
    def from_vision_config(cls, config: VisionConfig) -> "VisionServiceConfig":
        """Create from VisionConfig pydantic model."""
        return cls(
            camera=CameraConfig(
                width=config.camera_width,
                height=config.camera_height,
                fps=config.camera_fps,
                rotation=config.camera_rotation,
            ),
            hand_detector=HandDetectorConfig(
                max_hands=config.max_hands,
                min_detection_confidence=config.detection_confidence,
                min_tracking_confidence=config.tracking_confidence,
            ),
            gesture_cooldown_ms=config.gesture_cooldown_ms,
        )


class VisionService:
    """Main vision service orchestrating camera, detection, and gestures.

    Provides async event-driven gesture detection from camera input.

    Usage:
        service = VisionService()
        service.events.on(GestureType.THUMBS_UP, my_handler)
        await service.run()
    """

    def __init__(self, config: VisionServiceConfig | None = None) -> None:
        self._config = config or VisionServiceConfig()
        self._camera = CameraCapture(self._config.camera or CameraConfig())
        self._detector = HandDetector(self._config.hand_detector)
        self._recognizer = GestureRecognizer()
        self._events = GestureEventEmitter()
        self._running = False
        self._last_gesture: GestureType | None = None
        self._last_gesture_time: float = 0.0

    @property
    def events(self) -> GestureEventEmitter:
        """Access event emitter for registering handlers."""
        return self._events

    @property
    def is_running(self) -> bool:
        """Check if the vision service is running."""
        return self._running

    async def run(self) -> None:
        """Start vision processing loop.

        Captures frames, detects hands, recognizes gestures, and emits events.
        """
        self._running = True
        logger.info("Vision service starting...")

        cooldown_sec = self._config.gesture_cooldown_ms / 1000.0
        frame_count = 0

        try:
            async with self._camera.stream():
                logger.info("Camera stream active")

                async for frame in self._camera.frames():
                    if not self._running:
                        break

                    frame_count += 1

                    # Skip every other frame for performance on RPi
                    if frame_count % 2 != 0:
                        continue

                    # Detect hands
                    detections = self._detector.detect(frame)

                    if not detections:
                        continue

                    # Recognize gesture for first detected hand
                    for detection in detections:
                        result = self._recognizer.recognize(detection)

                        if not result.is_valid:
                            continue

                        # Apply cooldown to prevent gesture spam
                        now = time.monotonic()
                        if (
                            result.gesture == self._last_gesture
                            and (now - self._last_gesture_time) < cooldown_sec
                        ):
                            continue

                        self._last_gesture = result.gesture
                        self._last_gesture_time = now

                        # Emit gesture event
                        await self._events.emit(result)

        except Exception as e:
            logger.error(f"Vision service error: {e}")
            raise
        finally:
            self._running = False
            logger.info("Vision service stopped")

    def stop(self) -> None:
        """Signal the vision loop to stop."""
        self._running = False
        self._detector.close()
        logger.info("Vision service stop requested")

    async def run_once(self, frame) -> list[GestureResult]:
        """Process a single frame and return gesture results.

        Useful for testing or manual frame processing.
        """
        results = []
        detections = self._detector.detect(frame)

        for detection in detections:
            result = self._recognizer.recognize(detection)
            if result.is_valid:
                results.append(result)

        return results
