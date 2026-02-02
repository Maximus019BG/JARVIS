"""MediaPipe hand detection wrapper.

Provides hand landmark detection optimized for Raspberry Pi.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import numpy as np
from numpy.typing import NDArray

# Check if mediapipe is available
try:
    import mediapipe as mp

    MEDIAPIPE_AVAILABLE = True
except ImportError:
    mp = None
    MEDIAPIPE_AVAILABLE = False


class Handedness(str, Enum):
    """Hand side classification."""

    LEFT = "Left"
    RIGHT = "Right"


@dataclass(frozen=True, slots=True)
class Landmark:
    """Single hand landmark with 3D coordinates.

    Coordinates are normalized to [0, 1] relative to image dimensions.
    """

    x: float  # Normalized [0, 1] relative to image width
    y: float  # Normalized [0, 1] relative to image height
    z: float  # Depth relative to wrist (negative = towards camera)

    def to_pixel(self, width: int, height: int) -> tuple[int, int]:
        """Convert normalized coords to pixel coordinates."""
        return int(self.x * width), int(self.y * height)

    def distance_to(self, other: "Landmark") -> float:
        """Calculate Euclidean distance to another landmark."""
        import math

        return math.sqrt(
            (self.x - other.x) ** 2
            + (self.y - other.y) ** 2
            + (self.z - other.z) ** 2
        )


@dataclass(frozen=True, slots=True)
class HandDetection:
    """Complete detection result for a single hand.

    Contains 21 landmarks per MediaPipe hand model specification.
    """

    landmarks: tuple[Landmark, ...]  # 21 landmarks per hand
    handedness: Handedness
    confidence: float

    # Landmark indices (MediaPipe standard)
    WRIST = 0
    THUMB_CMC = 1
    THUMB_MCP = 2
    THUMB_IP = 3
    THUMB_TIP = 4
    INDEX_MCP = 5
    INDEX_PIP = 6
    INDEX_DIP = 7
    INDEX_TIP = 8
    MIDDLE_MCP = 9
    MIDDLE_PIP = 10
    MIDDLE_DIP = 11
    MIDDLE_TIP = 12
    RING_MCP = 13
    RING_PIP = 14
    RING_DIP = 15
    RING_TIP = 16
    PINKY_MCP = 17
    PINKY_PIP = 18
    PINKY_DIP = 19
    PINKY_TIP = 20

    def get_fingertips(self) -> dict[str, Landmark]:
        """Return dict of fingertip landmarks."""
        return {
            "thumb": self.landmarks[self.THUMB_TIP],
            "index": self.landmarks[self.INDEX_TIP],
            "middle": self.landmarks[self.MIDDLE_TIP],
            "ring": self.landmarks[self.RING_TIP],
            "pinky": self.landmarks[self.PINKY_TIP],
        }

    def get_palm_center(self) -> Landmark:
        """Approximate palm center from wrist and middle finger MCP."""
        wrist = self.landmarks[self.WRIST]
        middle_mcp = self.landmarks[self.MIDDLE_MCP]
        return Landmark(
            x=(wrist.x + middle_mcp.x) / 2,
            y=(wrist.y + middle_mcp.y) / 2,
            z=(wrist.z + middle_mcp.z) / 2,
        )

    def get_bounding_box(
        self, width: int, height: int, padding: float = 0.1
    ) -> tuple[int, int, int, int]:
        """Get bounding box in pixel coordinates.

        Returns:
            Tuple of (x_min, y_min, x_max, y_max) with padding.
        """
        xs = [lm.x for lm in self.landmarks]
        ys = [lm.y for lm in self.landmarks]

        x_min = max(0, min(xs) - padding)
        y_min = max(0, min(ys) - padding)
        x_max = min(1, max(xs) + padding)
        y_max = min(1, max(ys) + padding)

        return (
            int(x_min * width),
            int(y_min * height),
            int(x_max * width),
            int(y_max * height),
        )


@dataclass
class HandDetectorConfig:
    """Configuration for hand detector."""

    max_hands: int = 2
    min_detection_confidence: float = 0.5
    min_tracking_confidence: float = 0.5
    model_complexity: int = 0  # 0=Lite (fastest), 1=Full


class HandDetector:
    """MediaPipe hand detector with optimized settings for Raspberry Pi.

    Uses the legacy MediaPipe Hands solution for ARM compatibility.

    Usage:
        with HandDetector() as detector:
            detections = detector.detect(rgb_frame)
            for hand in detections:
                print(hand.handedness, hand.confidence)
    """

    def __init__(self, config: HandDetectorConfig | None = None) -> None:
        self._config = config or HandDetectorConfig()
        self._detector: Any = None
        self._mp_hands = None
        self._available = MEDIAPIPE_AVAILABLE
        if self._available:
            self._setup_detector()

    def _setup_detector(self) -> None:
        """Initialize MediaPipe Hands solution."""
        if not MEDIAPIPE_AVAILABLE:
            return

        self._mp_hands = mp.solutions.hands
        self._detector = self._mp_hands.Hands(
            static_image_mode=False,  # Video mode for tracking
            max_num_hands=self._config.max_hands,
            min_detection_confidence=self._config.min_detection_confidence,
            min_tracking_confidence=self._config.min_tracking_confidence,
            model_complexity=self._config.model_complexity,
        )

    @property
    def is_available(self) -> bool:
        """Check if MediaPipe is available."""
        return self._available

    def detect(self, frame: NDArray[np.uint8]) -> list[HandDetection]:
        """Detect hands in an RGB frame.

        Args:
            frame: RGB image as numpy array (H, W, 3).
                   Must be RGB format (not BGR).

        Returns:
            List of HandDetection objects (0-2 depending on max_hands config).
        """
        if self._detector is None:
            return []

        results = self._detector.process(frame)

        if not results.multi_hand_landmarks:
            return []

        detections = []
        for idx, hand_landmarks in enumerate(results.multi_hand_landmarks):
            # Extract handedness
            handedness_info = results.multi_handedness[idx]
            handedness = Handedness(handedness_info.classification[0].label)
            confidence = handedness_info.classification[0].score

            # Convert landmarks
            landmarks = tuple(
                Landmark(x=lm.x, y=lm.y, z=lm.z) for lm in hand_landmarks.landmark
            )

            detections.append(
                HandDetection(
                    landmarks=landmarks,
                    handedness=handedness,
                    confidence=confidence,
                )
            )

        return detections

    def close(self) -> None:
        """Release detector resources."""
        if self._detector:
            self._detector.close()
            self._detector = None

    def __enter__(self) -> "HandDetector":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
